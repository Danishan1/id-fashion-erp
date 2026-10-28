# IMPLEMENT SALES & MARKETING MODULE — EXISTING ERP

## 1. PROJECT OBJECTIVE

We are building a comprehensive ERP system with multiple interconnected business modules.

The CRM module has its own master blueprint and phased implementation plan. We now need to implement a separate, equally robust Sales & Marketing module within the same ERP.

The Sales & Marketing Feature Requirements Document is the functional source of truth for this assignment.

Your task is to inspect the existing ERP architecture, plan the implementation, and begin building the Sales & Marketing module incrementally.

This is an existing ERP project, not a new application.

Do not create a separate application, replace the existing architecture, or duplicate functionality already implemented by another module.

## 2. MANDATORY FIRST STEP: INSPECT THE EXISTING ERP

Before changing any files, inspect the repository and available architecture documentation.

Identify:

- Frontend framework and application structure.
- Backend framework and API architecture.
- Database engine, schema conventions, and migration system.
- Existing navigation, routing, layouts, and UI components.
- Authentication and authorization infrastructure.
- Existing organizations, tenants, branches, and business-unit handling.
- Existing CRM implementation and its current state.
- Existing product and customer master data.
- Existing quotation and Sales Order Management functionality.
- Existing Inventory, Production, Dispatch, and Finance modules.
- Existing reporting, notifications, event, audit, and background-job infrastructure.
- Existing test suites, development commands, and deployment configuration.

Inspect the Phase 00 architecture assessment and the Sales & Marketing Feature Requirements Document if they are available in the repository.

If either document is missing, report that fact. Use the requirements included in this prompt as the initial functional specification, and document any unresolved architectural assumptions.

Produce an architecture assessment identifying:

1. Existing capabilities that can be reused.
2. Missing capabilities that must be implemented.
3. Integration boundaries between modules.
4. Database ownership and relationships.
5. Dependencies and implementation risks.
6. A proposed phased development plan.
7. Relevant files and directories that will be affected.

Do not assume that a capability is missing simply because it is not visible in the navigation. Inspect the underlying implementation before deciding to build it.

## 3. ARCHITECTURAL RULES

The Sales & Marketing module must be a native module inside the existing ERP.

Follow the repository's established architectural conventions, naming standards, coding style, design system, API patterns, and security model.

Do not introduce a new framework, database, state-management library, or architectural pattern without a documented technical reason and approval.

### Reuse existing ERP systems

Reuse the existing implementations of:

- Authentication and authorization.
- Users, employees, organizations, and branches.
- CRM leads, contacts, companies, and opportunities.
- Product and service master data.
- Inventory and stock reservations.
- Sales orders and order fulfilment, if available.
- Finance, taxes, invoicing, and accounting.
- Notifications and communications.
- Audit logging.
- Event infrastructure.
- Background jobs.
- File storage.
- Reporting and shared UI components.

Do not create duplicate master data or competing transactional systems.

If a required upstream capability does not exist, document the gap and propose an appropriate implementation boundary before extending the scope.

## 4. MODULE STRUCTURE

Create the following logical areas, adapting names and directories to the existing ERP conventions.

Sales & Marketing
- Dashboard
- Sales Management
  - Sales Enquiries
  - Quotations and Proposals
  - Pricing and Price Lists
  - Discounts and Approvals
  - Sales Targets
  - Sales Forecasting
  - Sales Territories
  - Sales Team Performance
  - Sales Channels
  - Commissions and Incentives
  - Sales Reports
- Marketing Management
  - Marketing Dashboard
  - Campaigns
  - Campaign Calendar
  - Audience Segmentation
  - Marketing Channels
  - Promotions and Offers
  - Marketing Budgets
  - Marketing Assets and Templates
  - Campaign Attribution
  - Marketing Reports
- Sales & Marketing Analytics
- Integrations
- Settings

This is the intended functional structure. Do not build all these screens during the foundation phase.

Create only the routes, navigation entries, layout, and placeholder pages necessary for the approved phase.

## 5. PHASE 01: SALES & MARKETING FOUNDATION

Begin with the foundation only.

### 5.1 Navigation and routing

Implement:

- Sales & Marketing navigation entry.
- Module route structure.
- Nested navigation for approved sections.
- Module layout.
- Breadcrumbs.
- Page headers.
- Active navigation states.
- Route protection using existing ERP authorization.
- Consistent not-found and access-denied behavior.

Follow the existing ERP navigation and routing conventions.

Do not modify unrelated module routes unnecessarily.

### 5.2 Dashboard shell

Create the initial Sales & Marketing dashboard shell.

Include:

- Dashboard title and description.
- Date-range filter if consistent with existing dashboard patterns.
- Placeholder locations for future sales and marketing KPIs.
- Empty states explaining when data or functionality is not yet available.
- Loading and error states.
- Appropriate navigation to implemented sections.

Do not display invented sales figures, mock KPIs, fabricated campaign data, or misleading zero values as real business data.

If a KPI is not implemented, label the relevant section as unavailable or not yet implemented.

### 5.3 Shared UI components

Reuse existing ERP components wherever possible.

Implement or extend shared components only where required:

- Data table.
- Search field.
- Filter controls.
- Sorting and pagination.
- Record detail drawer or modal.
- Record header.
- Timeline or activity display where appropriate.
- Loading indicators.
- Empty states.
- Error states.
- Confirmation dialogs.
- Form validation and feedback.

Follow the existing design system and accessibility conventions.

Avoid creating multiple components that duplicate existing shared functionality.

### 5.4 API foundation

Establish the Sales & Marketing API namespace using existing backend conventions.

Implement only the endpoints necessary for the foundation, such as:

- Module health or capability status, if appropriate.
- Dashboard configuration or metadata, if required.
- Basic module configuration endpoints, if justified.

Do not create unnecessary endpoints or empty CRUD services for every future feature.

Use existing API authentication, authorization, validation, response formats, and error-handling conventions.

### 5.5 Database foundation

Inspect the existing schema before introducing database changes.

Create the minimum database infrastructure required for Phase 01.

Requirements:

- Follow existing table naming and migration conventions.
- Use existing organization or tenant references where applicable.
- Add appropriate constraints and indexes.
- Include audit fields consistent with the ERP.
- Implement reversible migrations where supported.
- Avoid creating premature tables for future features.
- Do not duplicate existing customers, users, products, orders, or financial records.

If the foundation requires no new tables, do not create artificial tables merely to establish a namespace.

### 5.6 Event and audit integration

Reuse the ERP's existing event and audit infrastructure.

Determine whether any new Phase 01 events are actually necessary.

If required, define stable event names, payload schemas, versioning conventions, and idempotency expectations.

Do not create a second audit system.

Do not implement the full workflow automation engine in this phase.

### 5.7 Module settings

Create only the basic configuration structure necessary for future extension.

Use existing ERP settings and authorization patterns.

Do not implement the full pricing engine, approval engine, campaign configuration, or integration provider management during Phase 01.

### 5.8 Testing

Add and run the appropriate tests for:

- Navigation and routing.
- Route authorization.
- Dashboard rendering.
- Loading, error, and empty states.
- API authorization and validation.
- Database migrations, if any.
- Existing module regression behavior.
- Build and type checking where supported.

Use the existing test framework.

Do not replace real tests with superficial assertions or claim that unexecuted tests have passed.

## 6. PHASE 01 COMPLETION CRITERIA

Phase 01 is complete only when:

1. Sales & Marketing is accessible through the existing ERP navigation.
2. Routes and breadcrumbs work correctly.
3. The module uses the existing ERP layout and design system.
4. The dashboard shell renders correctly.
5. Shared components are reused or implemented without unnecessary duplication.
6. API conventions and security are consistent with the ERP.
7. Database changes, if required, have valid migrations.
8. Existing audit and event infrastructure is reused.
9. Loading, error, and empty states work correctly.
10. Relevant tests have been executed and their actual results reported.
11. Existing ERP modules continue to function.
12. No unrelated modules have been refactored unnecessarily.
13. The changed files and remaining limitations are documented.

## 7. FUTURE IMPLEMENTATION ROADMAP

After Phase 01 is reviewed and accepted, proceed through the following phases.

Phase 02: Sales Enquiries and Quotation Management.

Phase 03: Pricing, Price Lists, and Discount Engine.

Phase 04: Sales Order Integration.

Phase 05: Sales Targets, Territories, and Team Performance.

Phase 06: Sales Forecasting and Analytics.

Phase 07: Sales Channels, Commissions, and Incentives.

Phase 08: Marketing Foundation and Campaign Management.

Phase 09: Audience Segmentation and Targeting.

Phase 10: Marketing Channels and Provider Integrations.

Phase 11: Marketing Assets, Templates, and Content.

Phase 12: Promotions, Offers, and Campaign Budgets.

Phase 13: Campaign Attribution and ROI Analytics.

Phase 14: Shared Bulk Operations and Advanced Processing.

Phase 15: Sales & Marketing Workflow Integration.

Phase 16: External Integrations, Webhooks, and API Ecosystem.

Phase 17: Advanced Reporting and Business Intelligence.

Treat this roadmap as a phased plan, not authorization to implement every phase in the current task.

Before beginning each phase, inspect its dependencies, confirm the existing implementation state, define acceptance criteria, and implement only the approved scope.

## 8. DEVELOPMENT WORKFLOW

Follow this workflow:

Step 1: Inspect the repository and relevant documentation.

Step 2: Report the architecture assessment and proposed file changes.

Step 3: Identify existing functionality that must be reused.

Step 4: Identify missing functionality and unresolved dependencies.

Step 5: Prepare the Phase 01 implementation plan.

Step 6: Implement the foundation using small, reviewable changes.

Step 7: Run migrations and relevant tests where applicable.

Step 8: Run the build, linting, and type checks supported by the project.

Step 9: Review the changes for security, duplication, and regressions.

Step 10: Report completion and remaining work.

If you have direct repository access and the environment permits implementation, proceed with Phase 01 after completing the initial inspection.

If essential information is missing or an architectural decision could create significant rework, stop and ask for clarification rather than guessing.

Do not stop after merely generating a plan if the repository is accessible and implementation is authorized.

## 9. REQUIRED FINAL REPORT

At the end of the task, provide:

### Architecture Assessment
- Existing stack and conventions.
- Existing reusable modules.
- Identified dependencies.
- Important assumptions and risks.

### Implementation Summary
- Features implemented.
- Features deliberately deferred.
- Integration decisions.

### Changed Files
For each changed file, explain its purpose.

### Database Changes
- Migrations created or modified.
- Schema changes.
- Rollback considerations.

### API and Events
- Endpoints added.
- Event contracts added or reused.
- Authorization and validation behavior.

### Testing
- Commands actually executed.
- Tests passed.
- Tests failed.
- Tests not executed and the reason.

### Verification
- Build and type-check results.
- Existing-module regression results.
- Known limitations.

### Next Phase
Provide the proposed scope and dependencies for Phase 02.

## 10. FINAL INSTRUCTIONS

The existing ERP repository is the source of truth for technical architecture.

The Sales & Marketing Feature Requirements Document is the source of truth for business scope.

Implement the smallest complete foundation that satisfies Phase 01.

Prioritize correctness, maintainability, security, integration, and regression prevention over the number of files or screens created.

Do not fabricate functionality, test results, or successful integrations.

Do not rebuild existing ERP functionality.

Begin by inspecting the repository and architecture documentation, then proceed with Phase 01 in accordance with the requirements above.