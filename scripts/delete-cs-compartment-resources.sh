#!/bin/bash
# Delete all resources in Claes Sandahl's CS compartment
# Run each step and verify before proceeding to the next
set -e

AUTH="--auth api_key"

echo "=== Step 1: Delete bucket object ==="
oci os object delete --bucket-name receipt-images-bucket \
  --object-name "ICA_Nara_Alvsjo_2025-09-01.jpg" \
  $AUTH --force
echo "Object deleted."

echo ""
echo "=== Step 2: Delete bucket ==="
oci os bucket delete --bucket-name receipt-images-bucket \
  $AUTH --force
echo "Bucket deleted."

echo ""
echo "=== Step 3: Terminate Autonomous Database ==="
oci db autonomous-database delete \
  --autonomous-database-id ocid1.autonomousdatabase.oc1.eu-frankfurt-1.antheljthhxc6pyai4mujpqagmmse7nuj526mlzxwr3mupmgd3drsrmejvdq \
  $AUTH --force
echo "ADB termination initiated (may take a few minutes)."

echo ""
echo "=== Step 4: Delete IAM Policies ==="
oci iam policy delete \
  --policy-id ocid1.policy.oc1..aaaaaaaaueqycjwa7a6q2b37d2roirz5wim3gcqy7xrcudeytipdxbdnepra \
  $AUTH --force
echo "Policy 'vision-service-policy' deleted."

oci iam policy delete \
  --policy-id ocid1.policy.oc1..aaaaaaaal72oz3wkthce7cz6pnqegtillql34ovcvfzwq36khcbjr5cjp4mq \
  $AUTH --force
echo "Policy 'vision-object-storage-access' deleted."

echo ""
echo "=== Step 5: Delete Log Analytics Entity ==="
oci log-analytics entity delete \
  --namespace-name oraseemeaswedemo \
  --log-analytics-entity-id ocid1.loganalyticsentity.oc1.eu-frankfurt-1.amaaaaaahhxc6pyaxjjpb4gbwybl6m732ar7twwpwgxs242ndnlczfodzlya \
  $AUTH --force
echo "Log Analytics entity deleted."

echo ""
echo "=== All resources deleted ==="
echo "To also delete the compartment itself, run:"
echo "oci iam compartment delete --compartment-id ocid1.compartment.oc1..aaaaaaaam4mktdludlgd2jhsfjhv3jsvhcwstuebmr4w47xc3p3npbt4wiva $AUTH --force"
