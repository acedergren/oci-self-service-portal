# OCI AI Chat - Self-Service Portal Demo Script

## Overview

This document provides a comprehensive demo script for showcasing the OCI AI Chat Self-Service Portal. The demo highlights the AI-powered cloud management capabilities, including guided workflows, natural language queries, and intelligent requirement gathering.

**Target Audience:** Cloud architects, DevOps engineers, IT managers, OCI prospects
**Duration:** 10-15 minutes (can be shortened to 5 minutes for quick demos)
**Prerequisites:** Dev server running at http://localhost:5173

---

## Demo Environment Setup

### Before the Demo

1. **Start the development server:**
   ```bash
   cd /Users/acedergr/Projects/oci-genai-examples/oci-ai-chat
   pnpm dev
   ```

2. **Verify the server is running:**
   - Navigate to http://localhost:5173/self-service
   - Ensure the page loads without errors

3. **Browser setup:**
   - Use Chrome or Firefox (latest version)
   - Clear chat history if needed (refresh the page)
   - Set browser zoom to 100%
   - Hide bookmarks bar for cleaner screenshots

4. **Configure opencode-browser (for automated demos):**
   ```bash
   # Verify browser plugin is connected
   opencode browser_status
   ```

---

## Demo Scenario 1: Portal Overview (2 minutes)

### Objective
Introduce the Self-Service Portal and its key features.

### Steps

#### Step 1: Navigate to Portal
- **Action:** Open http://localhost:5173/self-service
- **Talking Points:**
  - "Welcome to the OCI Cloud Self-Service Portal"
  - "This is an AI-powered interface for managing Oracle Cloud Infrastructure"
  - "Notice the personalized greeting - the system recognizes the logged-in user"

#### Step 2: Highlight Header Navigation
- **Action:** Point to the header navigation
- **Talking Points:**
  - "Quick navigation between Home, Services, and AI Chat"
  - "Notification badge shows pending alerts"
  - "User profile with quick access to settings"

#### Step 3: Show Service Categories
- **Action:** Scroll to Service Categories grid
- **Talking Points:**
  - "Six main service categories covering all OCI services"
  - "Each card shows quick actions for common tasks"
  - "Compute, Database, Networking, Storage, Identity, and Monitoring"

#### Step 4: Highlight Guided Workflows
- **Action:** Scroll to Guided Workflows section
- **Talking Points:**
  - "Pre-built workflows for complex multi-step operations"
  - "Each workflow shows estimated time and number of steps"
  - "AI assistant guides you through each step"

---

## Demo Scenario 2: Knowledge Query (3 minutes)

### Objective
Demonstrate the AI's ability to answer OCI knowledge questions without calling tools.

### Steps

#### Step 1: Use the Search Box
- **Action:** Click in the search box
- **Talking Points:**
  - "Natural language interface - just type what you want to know"
  - "The AI understands context and OCI-specific terminology"

#### Step 2: Ask About Free Tier
- **Action:** Type: "What does OCI Always Free tier include?"
- **Action:** Press Enter or click submit
- **Talking Points:**
  - "Notice the AI command palette opens"
  - "The AI processes your request without calling any tools"
  - "This is a knowledge query - no infrastructure changes needed"

#### Step 3: Review the Response
- **Action:** Wait for AI response
- **Talking Points:**
  - "The AI provides comprehensive information about Free Tier"
  - "Mentions ARM compute, storage, databases, and other free resources"
  - "No tools were called - this is pure AI knowledge"

#### Step 4: Ask a Follow-up Question
- **Action:** Type: "Can I run a production web server on Free Tier?"
- **Talking Points:**
  - "Context is maintained across the conversation"
  - "The AI considers the previous discussion about Free Tier"
  - "Provides practical advice about limitations"

---

## Demo Scenario 3: Cloud Cost Comparison (4 minutes)

### Objective
Show the AI-powered cost comparison between OCI and Azure.

### Steps

#### Step 1: Start the Workflow
- **Action:** Click "Cloud Cost Analysis" workflow card
- **Talking Points:**
  - "This workflow compares pricing across cloud providers"
  - "Notice the workflow panel showing the 5 steps"
  - "The AI will guide us through each step"

#### Step 2: AI Gathers Requirements
- **Action:** Wait for AI response
- **Talking Points:**
  - "**CRITICAL:** Notice the AI asks questions first!"
  - "It needs to know vCPUs, memory, storage, and region"
  - "This prevents failed tool calls from missing parameters"

#### Step 3: Provide Requirements
- **Action:** Type: "Compare costs for a 4 vCPU, 32GB RAM web server running 24/7 in Western Europe. I need 500GB storage and expect about 100GB monthly egress."
- **Talking Points:**
  - "We provide specific requirements in natural language"
  - "The AI extracts the relevant parameters"

#### Step 4: Watch Tool Execution
- **Action:** Observe the tool cards appearing
- **Talking Points:**
  - "Now the AI calls the pricing tools with our requirements"
  - "OCI pricing is fetched first, then Azure"
  - "Tool cards show status: pending, running, completed"

#### Step 5: Review Comparison
- **Action:** Read the AI's analysis
- **Talking Points:**
  - "Side-by-side cost comparison"
  - "OCI typically shows 30-50% savings"
  - "AI explains the differences and recommends the best option"

---

## Demo Scenario 4: Provision Web Server Workflow (5 minutes)

### Objective
Demonstrate the full provisioning workflow with Terraform generation.

### Steps

#### Step 1: Navigate Back to Portal
- **Action:** Click the X to close the chat, or refresh the page
- **Talking Points:**
  - "Let's look at a more complex provisioning workflow"

#### Step 2: Start Provision Web Server Workflow
- **Action:** Click "Provision Web Server" workflow card
- **Talking Points:**
  - "This is an 8-step workflow"
  - "It gathers requirements, checks infrastructure, and generates Terraform"
  - "No resources are provisioned without your approval"

#### Step 3: AI Gathers Requirements (CRITICAL BEHAVIOR)
- **Action:** Wait for AI response
- **Talking Points:**
  - "**KEY DEMO POINT:** The AI asks clarifying questions first"
  - "It needs to know: region, shape, OS, memory, purpose"
  - "This is the intelligent behavior we've built in"
  - "Without this, tools would fail from missing parameters"

#### Step 4: Provide Web Server Requirements
- **Action:** Type: "I need a web server in Frankfurt (eu-frankfurt-1) with 2 OCPUs and 16GB RAM. Use Oracle Linux 8. This will host a Node.js application."
- **Talking Points:**
  - "We specify all the key parameters"
  - "The AI understands 'Frankfurt' means eu-frankfurt-1"
  - "It knows to recommend a VM.Standard.E4.Flex shape"

#### Step 5: Watch Infrastructure Discovery
- **Action:** Observe tool calls
- **Talking Points:**
  - "AI now calls discovery tools:"
  - "Lists compartments to find the right one"
  - "Checks availability domains in Frankfurt"
  - "Lists available shapes matching our requirements"
  - "Finds compatible Oracle Linux 8 images"
  - "Checks existing VCNs and subnets"

#### Step 6: Review Terraform Output
- **Action:** Scroll to see the Terraform code
- **Talking Points:**
  - "Instead of directly provisioning, we generate Terraform"
  - "This gives you Infrastructure as Code"
  - "You can review, modify, and version control it"
  - "Includes main.tf, variables.tf, and outputs.tf"

#### Step 7: Discuss Next Steps
- **Action:** Read the AI's deployment instructions
- **Talking Points:**
  - "The AI provides clear next steps"
  - "terraform init, plan, apply workflow"
  - "You maintain full control over the deployment"

---

## Demo Scenario 5: Quick Actions (2 minutes)

### Objective
Show rapid interactions using quick action buttons.

### Steps

#### Step 1: Use Quick Actions
- **Action:** Point to the quick action buttons
- **Talking Points:**
  - "For common tasks, use quick actions"
  - "One-click access to frequent queries"

#### Step 2: Click "View compartments"
- **Action:** Click the "View compartments" quick action
- **Talking Points:**
  - "Instantly queries your compartment structure"
  - "Shows hierarchy and OCIDs"
  - "Useful for understanding your organization"

#### Step 3: Click "Compare OCI vs Azure"
- **Action:** Click the cost comparison quick action
- **Talking Points:**
  - "Even quick actions go through requirement gathering"
  - "The AI asks for your specific workload"

---

## Critical Demo Points to Emphasize

### 1. Intelligent Requirement Gathering
> "The AI ALWAYS asks clarifying questions before executing provisioning tools. This prevents failures and ensures the right resources are created."

### 2. No Surprise Provisioning
> "The system generates Terraform code rather than directly provisioning. You review and approve everything before deployment."

### 3. Context-Aware Responses
> "The AI understands OCI terminology, region codes, shape families, and best practices. It provides expert-level guidance."

### 4. Three Modes of Operation
- **Knowledge Mode:** Pure AI responses, no tool calls
- **Query Mode:** Read-only tools to list and describe resources
- **Provisioning Mode:** Requires requirements first, generates IaC

---

## Troubleshooting Common Demo Issues

### Issue: AI calls tools immediately without asking questions
**Solution:** This is the bug we fixed! If it happens:
1. Refresh the page
2. Check that the model is set to `google.gemini-2.5-flash`
3. Verify the system prompt includes the CRITICAL RULE

### Issue: Tool cards show "Failed" status
**Solution:** 
1. The AI should not be calling tools without parameters
2. If this happens, it indicates the requirement-gathering behavior isn't working
3. Check the network tab for the actual error

### Issue: Chat doesn't respond
**Solution:**
1. Check browser console for errors
2. Verify the dev server is running
3. Check network connectivity

### Issue: Workflow panel doesn't appear
**Solution:**
1. Only workflow-triggered chats show the panel
2. Quick actions and search queries don't show it
3. Refresh and try clicking a workflow card again

---

## Appendix: Key Selectors for Automation

```javascript
// Portal elements
const SELECTORS = {
  searchBox: 'input[placeholder*="Ask"]',
  submitButton: 'button[type="submit"]',
  quickActions: '.quick-link',
  workflowCards: '.workflow-card',
  commandPalette: '.command-palette',
  commandInput: '.command-input input',
  assistantMessage: '.message[data-role="assistant"]',
  toolCard: '.tool-card',
  closeButton: '.command-close',
};
```

---

## Appendix: Expected AI Responses

### For "Provision Web Server" workflow:
The AI should respond with something like:
> "I'd be happy to help you provision a web server on OCI. To generate the right Terraform configuration, I need to know a few things:
> 1. **Region:** Which OCI region do you want to deploy to?
> 2. **Compute Shape:** How many vCPUs and how much memory do you need?
> 3. **Operating System:** What OS do you prefer? (Oracle Linux, Ubuntu, etc.)
> 4. **Purpose:** What will this server be used for?
> 
> Please share these details and I'll help you set up the infrastructure."

### For "Cloud Cost Comparison" workflow:
The AI should respond with something like:
> "I'll help you compare OCI and Azure costs. To provide an accurate comparison, please tell me:
> 1. **Compute requirements:** vCPUs and RAM needed
> 2. **Storage:** How much storage do you need?
> 3. **Network:** Expected monthly egress (data transfer out)
> 4. **Region:** Which geographic region?
> 5. **Usage:** 24/7 or variable hours per month?
> 
> With these details, I can give you a detailed cost comparison."

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Feb 5, 2026 | Initial demo script |

---

*Last updated: February 5, 2026*
