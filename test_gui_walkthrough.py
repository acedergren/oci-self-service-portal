#!/usr/bin/env python3
"""
GUI walkthrough test for OCI AI Chat application.
Tests the main chat interface and approval system.
"""

from playwright.sync_api import sync_playwright, expect
import os

# Create screenshots directory
os.makedirs("/tmp/oci-chat-screenshots", exist_ok=True)


def screenshot(page, name):
    """Helper to take timestamped screenshots."""
    path = f"/tmp/oci-chat-screenshots/{name}.png"
    page.screenshot(path=path, full_page=True)
    print(f"Screenshot saved: {path}")
    return path


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})

        # Enable console logging
        page.on("console", lambda msg: print(f"[CONSOLE] {msg.type}: {msg.text}"))
        page.on("pageerror", lambda err: print(f"[PAGE ERROR] {err}"))

        print("\n=== Step 1: Navigate to main page ===")
        page.goto("http://localhost:5173")
        page.wait_for_load_state("networkidle")
        screenshot(page, "01_initial_load")

        # Check for any errors in the page
        error_elements = page.locator(".text-error").all()
        if error_elements:
            print(f"Found {len(error_elements)} error elements on page")

        print("\n=== Step 2: Inspect page structure ===")
        # Get key elements
        header = page.locator("header").first
        assert header.is_visible(), "Header should be visible"

        # Check for sidebar
        sidebar = page.locator("aside").first
        assert sidebar.is_visible(), "Sidebar should be visible"

        # Check for chat input
        chat_input = page.locator('input[placeholder*="OCI"]').first
        assert chat_input.is_visible(), "Chat input should be visible"

        # Check for model badge
        model_badge = page.locator("text=llama").first
        assert model_badge.is_visible(), "Model badge should be visible"

        print("\n=== Step 3: Check status bar ===")
        status_bar = page.locator("footer").first
        print(f"Status bar content: {status_bar.text_content()}")

        print("\n=== Step 4: Check Sessions sidebar ===")
        # Look for New Chat button
        new_chat_btn = page.locator("text=New Chat").first
        assert new_chat_btn.is_visible(), "New Chat button should be visible"

        print("\n=== Step 5: Capture full DOM structure ===")
        buttons = page.locator("button").all()
        print(f"Total buttons: {len(buttons)}")

        inputs = page.locator("input").all()
        print(f"Total inputs: {len(inputs)}")

        # Check for panels
        tool_panel = page.locator("text=Tools").first
        assert tool_panel.is_visible(), "Tools panel should be visible"

        print("\n=== Step 6: Test chat interaction ===")
        # Find and click on the chat input
        chat_input = page.locator('input[placeholder*="OCI"]').first
        assert chat_input.is_visible(), "Chat input should be visible for interaction"
        chat_input.click()
        chat_input.fill("List my compute instances")
        screenshot(page, "02_chat_input_filled")

        # Find and click send button
        send_btn = page.locator('button[type="submit"]').first
        assert send_btn.is_visible(), "Send button should be visible"
        print("Clicking send button...")
        send_btn.click()

        # Wait for response to start streaming
        page.wait_for_selector('[class*="message"], [class*="assistant"]', timeout=10000)
        screenshot(page, "03_after_send")

        # Wait for streaming to complete (look for finish indicators)
        page.wait_for_selector('[class*="message"]', state="attached", timeout=15000)
        screenshot(page, "04_after_response")

        print("\n=== Step 7: Check for tool executions ===")
        tool_badges = page.locator('.message-tool, [class*="tool"]').all()
        print(f"Tool-related elements: {len(tool_badges)}")

        spinners = page.locator('[class*="spinner"], [class*="animate"]').all()
        print(f"Animated/spinner elements: {len(spinners)}")

        print("\n=== Step 8: Verify approval system elements ===")
        approval_elements = page.locator('[class*="approval"]').all()
        print(f"Approval-related elements visible: {len(approval_elements)}")

        # Check for keyboard shortcut hints in status bar
        shortcuts = page.locator("footer span").all()
        for s in shortcuts:
            text = s.text_content()
            if text:
                print(f"  Shortcut hint: {text}")

        print("\n=== Step 9: Test side panel toggle ===")
        toggle_btn = page.locator('button[aria-label="Toggle side panel"]').first
        if toggle_btn.is_visible():
            print("Clicking side panel toggle...")
            toggle_btn.click()
            page.wait_for_selector('button[aria-label="Toggle side panel"]', timeout=2000)
            screenshot(page, "05_side_panel_toggled")

        print("\n=== Step 10: Test model picker ===")
        model_badge = page.locator('[title*="model"]').first
        if model_badge.is_visible():
            print("Opening model picker...")
            model_badge.click()
            page.wait_for_selector('[title*="model"]', timeout=2000)
            screenshot(page, "06_model_picker_open")
            page.keyboard.press("Escape")

        print("\n=== Final Summary ===")
        screenshot(page, "07_final_state")
        print(f"Page title: {page.title()}")
        print(f"Current URL: {page.url}")

        browser.close()
        print("\n=== Test completed successfully ===")


if __name__ == "__main__":
    main()
