#!/usr/bin/env bash
set -euo pipefail

# LinkedIn API posting script
# Requires: LINKEDIN_ACCESS_TOKEN environment variable
# Optional: LINKEDIN_PERSON_ID (auto-fetched if not set)

LINKEDIN_API="https://api.linkedin.com"
LINKEDIN_VERSION="202506"

die() { echo "ERROR: $*" >&2; exit 1; }

check_token() {
  [[ -n "${LINKEDIN_ACCESS_TOKEN:-}" ]] || die "LINKEDIN_ACCESS_TOKEN not set. Run: /linkedin-post --setup"
}

api_headers() {
  echo -H "Authorization: Bearer ${LINKEDIN_ACCESS_TOKEN}"
  echo -H "LinkedIn-Version: ${LINKEDIN_VERSION}"
  echo -H "X-Restli-Protocol-Version: 2.0.0"
  echo -H "Content-Type: application/json"
}

get_person_id() {
  if [[ -n "${LINKEDIN_PERSON_ID:-}" ]]; then
    echo "${LINKEDIN_PERSON_ID}"
    return
  fi

  local response
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer ${LINKEDIN_ACCESS_TOKEN}" \
    "${LINKEDIN_API}/v2/userinfo")

  local http_code body
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  [[ "$http_code" == "200" ]] || die "Failed to fetch person ID (HTTP ${http_code}): ${body}"

  local person_id
  person_id=$(echo "$body" | jq -r '.sub // empty')
  [[ -n "$person_id" ]] || die "Could not parse person ID from response: ${body}"

  echo "$person_id"
}

cmd_whoami() {
  check_token
  local person_id
  person_id=$(get_person_id)

  local profile
  profile=$(curl -s \
    -H "Authorization: Bearer ${LINKEDIN_ACCESS_TOKEN}" \
    "${LINKEDIN_API}/v2/userinfo")

  local name email
  name=$(echo "$profile" | jq -r '.name // "unknown"')
  email=$(echo "$profile" | jq -r '.email // "unknown"')

  echo "Person ID: ${person_id}"
  echo "Name: ${name}"
  echo "Email: ${email}"
  echo "Person URN: urn:li:person:${person_id}"
}

cmd_post_text() {
  check_token
  local text="$1"
  local person_id
  person_id=$(get_person_id)

  [[ -n "$text" ]] || die "Post text is empty"

  local payload
  payload=$(jq -n \
    --arg author "urn:li:person:${person_id}" \
    --arg text "$text" \
    '{
      author: $author,
      commentary: $text,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: []
      },
      lifecycleState: "PUBLISHED"
    }')

  local response
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer ${LINKEDIN_ACCESS_TOKEN}" \
    -H "LinkedIn-Version: ${LINKEDIN_VERSION}" \
    -H "X-Restli-Protocol-Version: 2.0.0" \
    -H "Content-Type: application/json" \
    -X POST \
    -d "$payload" \
    "${LINKEDIN_API}/rest/posts")

  local http_code body
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  if [[ "$http_code" == "201" || "$http_code" == "200" ]]; then
    local post_id
    post_id=$(echo "$body" | jq -r '.id // empty')
    if [[ -z "$post_id" ]]; then
      # LinkedIn returns the ID in the x-restli-id header, but curl -s doesn't capture headers
      # Try extracting from response headers
      post_id="(check LinkedIn for post)"
    fi
    echo "SUCCESS: Post published"
    echo "Post ID: ${post_id}"
  else
    die "Failed to post (HTTP ${http_code}): ${body}"
  fi
}

cmd_upload_image() {
  check_token
  local image_path="$1"
  local person_id
  person_id=$(get_person_id)

  [[ -f "$image_path" ]] || die "Image file not found: ${image_path}"

  # Step 1: Initialize upload
  local init_payload
  init_payload=$(jq -n \
    --arg owner "urn:li:person:${person_id}" \
    '{
      initializeUploadRequest: {
        owner: $owner
      }
    }')

  local init_response
  init_response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer ${LINKEDIN_ACCESS_TOKEN}" \
    -H "LinkedIn-Version: ${LINKEDIN_VERSION}" \
    -H "X-Restli-Protocol-Version: 2.0.0" \
    -H "Content-Type: application/json" \
    -X POST \
    -d "$init_payload" \
    "${LINKEDIN_API}/rest/images?action=initializeUpload")

  local http_code body
  http_code=$(echo "$init_response" | tail -1)
  body=$(echo "$init_response" | sed '$d')

  [[ "$http_code" == "200" ]] || die "Failed to initialize image upload (HTTP ${http_code}): ${body}"

  local upload_url image_urn
  upload_url=$(echo "$body" | jq -r '.value.uploadUrl // empty')
  image_urn=$(echo "$body" | jq -r '.value.image // empty')

  [[ -n "$upload_url" ]] || die "No upload URL in response: ${body}"
  [[ -n "$image_urn" ]] || die "No image URN in response: ${body}"

  # Step 2: Upload binary
  local upload_response
  upload_response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer ${LINKEDIN_ACCESS_TOKEN}" \
    -X PUT \
    --upload-file "$image_path" \
    "$upload_url")

  http_code=$(echo "$upload_response" | tail -1)

  [[ "$http_code" == "201" || "$http_code" == "200" ]] || die "Failed to upload image (HTTP ${http_code})"

  echo "$image_urn"
}

cmd_post_image() {
  check_token
  local text="$1"
  local image_path="$2"
  local person_id
  person_id=$(get_person_id)

  [[ -n "$text" ]] || die "Post text is empty"

  # Upload image first
  local image_urn
  image_urn=$(cmd_upload_image "$image_path")

  echo "Image uploaded: ${image_urn}"

  # Create post with image
  local payload
  payload=$(jq -n \
    --arg author "urn:li:person:${person_id}" \
    --arg text "$text" \
    --arg image "$image_urn" \
    '{
      author: $author,
      commentary: $text,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: []
      },
      content: {
        media: {
          id: $image
        }
      },
      lifecycleState: "PUBLISHED"
    }')

  local response
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer ${LINKEDIN_ACCESS_TOKEN}" \
    -H "LinkedIn-Version: ${LINKEDIN_VERSION}" \
    -H "X-Restli-Protocol-Version: 2.0.0" \
    -H "Content-Type: application/json" \
    -X POST \
    -d "$payload" \
    "${LINKEDIN_API}/rest/posts")

  local http_code body
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  if [[ "$http_code" == "201" || "$http_code" == "200" ]]; then
    echo "SUCCESS: Post with image published"
  else
    die "Failed to post (HTTP ${http_code}): ${body}"
  fi
}

cmd_post_multi_image() {
  check_token
  local text="$1"
  shift
  local person_id
  person_id=$(get_person_id)

  [[ -n "$text" ]] || die "Post text is empty"

  # Upload all images
  local image_urns=()
  for img in "$@"; do
    echo "Uploading: ${img}..."
    local urn
    urn=$(cmd_upload_image "$img")
    image_urns+=("$urn")
    echo "  Uploaded: ${urn}"
  done

  # Build images array for jq
  local images_json="[]"
  for urn in "${image_urns[@]}"; do
    images_json=$(echo "$images_json" | jq --arg id "$urn" '. + [{"id": $id}]')
  done

  local payload
  payload=$(jq -n \
    --arg author "urn:li:person:${person_id}" \
    --arg text "$text" \
    --argjson images "$images_json" \
    '{
      author: $author,
      commentary: $text,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: []
      },
      content: {
        multiImage: {
          images: $images
        }
      },
      lifecycleState: "PUBLISHED"
    }')

  local response
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer ${LINKEDIN_ACCESS_TOKEN}" \
    -H "LinkedIn-Version: ${LINKEDIN_VERSION}" \
    -H "X-Restli-Protocol-Version: 2.0.0" \
    -H "Content-Type: application/json" \
    -X POST \
    -d "$payload" \
    "${LINKEDIN_API}/rest/posts")

  local http_code body
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  if [[ "$http_code" == "201" || "$http_code" == "200" ]]; then
    echo "SUCCESS: Post with ${#image_urns[@]} images published"
  else
    die "Failed to post (HTTP ${http_code}): ${body}"
  fi
}

# --- Main ---
case "${1:-help}" in
  whoami)
    cmd_whoami
    ;;
  text)
    shift
    if [[ "${1:-}" == "-" || -z "${1:-}" ]]; then
      text=$(cat)
    elif [[ -f "${1:-}" ]]; then
      text=$(cat "$1")
    else
      text="$1"
    fi
    cmd_post_text "$text"
    ;;
  image)
    shift
    local_text="${1:?Usage: linkedin-post.sh image <text> <image-path>}"
    local_image="${2:?Usage: linkedin-post.sh image <text> <image-path>}"
    if [[ -f "$local_text" ]]; then
      local_text=$(cat "$local_text")
    fi
    cmd_post_image "$local_text" "$local_image"
    ;;
  multi-image)
    shift
    local_text="${1:?Usage: linkedin-post.sh multi-image <text> <img1> <img2> ...}"
    shift
    if [[ -f "$local_text" ]]; then
      local_text=$(cat "$local_text")
    fi
    cmd_post_multi_image "$local_text" "$@"
    ;;
  help|--help|-h)
    echo "Usage: linkedin-post.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  whoami                              Show authenticated user info"
    echo "  text <content|file|->               Post text (string, file path, or stdin)"
    echo "  image <text> <image-path>           Post text with single image"
    echo "  multi-image <text> <img1> [img2...] Post text with multiple images"
    echo ""
    echo "Environment:"
    echo "  LINKEDIN_ACCESS_TOKEN  (required) OAuth2 Bearer token"
    echo "  LINKEDIN_PERSON_ID    (optional) Your LinkedIn person ID (auto-fetched)"
    ;;
  *)
    die "Unknown command: $1. Run with --help for usage."
    ;;
esac
