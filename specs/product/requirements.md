Product Dashboard Requirements
Overview

The Product Dashboard is a centralized operations module for the Round Rock CO-OP School Store. It manages purchasing, inventory-driven ordering, vendor coordination, product design tracking, and future merchandise planning.

The system enables staff to:

Create and track product orders

Receive and archive completed orders

Maintain vendor and purchasing records

Store and prioritize merchandise designs

Manage a wishlist of potential products

Automatically prompt reorder actions after inventory checks

The system must support UI-based editing and database persistence for all records.

Default Order Header Information

Each order form must include the following pre-filled values (editable):

Requester Name: Eric Chaverria

Activity Account: Round Rock CO-OP (School Store)

Account Number: 498-36-001-99-8468-6399

These values should be stored in a settings table and configurable via admin UI.

Registered Vendors

The system must include a vendor registry with editable entries.

Default Vendors

Coca-Cola

Sam’s Club

HEB

Amazon

Hobby Lobby

Home Depot

Target

Party City

Vendor Fields

Vendor name

Ordering method (online / in-store / phone)

Default product link (optional)

Notes (tax-exempt info, lead time, special instructions)

Active / inactive toggle

MODULES
1. Product Orders Module
Purpose

Allows staff to create, manage, track, and archive purchase orders.

Order Fields
Order Header

Order ID (auto-generated)

Requester name (default editable)

Activity account (default editable)

Account number (default editable)

Vendor

Order status

Date placed (auto)

Requested pickup date / ASAP toggle

Expected arrival date (optional)

Reason for purchase

Priority level (Normal / Urgent)

Notes

Line Item Fields

Each order may contain multiple line items.

Item name (catalog select or custom)

Quantity

Unit price

Total price (auto-calculated)

Product link

Extra information

File uploads (quotes, screenshots, invoices)

System Calculations

Line Total = Qty × Unit Price

Order Total = Sum of line totals

Order Status Lifecycle

Orders must use structured status states:

Draft

Submitted

Approved

Ordered

Partially Received

Received

Archived

Cancelled

Each status change logs:

Timestamp

User who performed the action

Receiving Workflow

When items arrive:

Record received quantity per line item

Mark condition issues (optional)

Upload receipt or packing slip

Mark order as:

Partially received

Fully received

Completed orders can be archived but remain searchable.

Order Actions

Users can:

Create order

Edit order

Duplicate / reorder

Upload attachments

Mark received

Archive

Cancel

2. Inventory-Based Order Prompting
Purpose

Automatically suggest reorders after inventory checks.

Trigger Condition

After an inventory upload:

If an item meets BOTH conditions:

Current stock = 0 OR below threshold (<5)

Item is not already on an active open order

→ System generates reorder prompt.

Prompt Behavior

Prompt displays:

Item name

Current stock

Preferred vendor

Last purchase price

Product link

Suggested reorder quantity

One-click “Create Order” button

Inventory Fields Required

SKU / product ID

Current quantity

Re-order threshold

Par level (target stock)

Preferred vendor

On-order quantity (auto-calculated)

Suggested Reorder Formula
Suggested Order Qty = Par Level − (Current Stock + On Order)
3. Product Catalog (Recommended)
Purpose

Standardize items and support inventory + reorder automation.

Fields

SKU / internal ID

Product name

Category

Vendor link

Default vendor

Default cost

Retail price (optional)

Barcode / UPC (future scanning)

Reorder threshold

Par level

Active / inactive

Orders may reference catalog items or allow custom entries.

4. Product Design Module
Purpose

Store and manage merchandise designs and future apparel items.

Design Fields

Design name

Category (T-shirt, hoodie, sticker, etc.)

Front image

Back image

Additional mockups

Color options

Notes

Estimated cost

Preferred vendor

Priority level

Status:

Idea

Review

Approved

Ready to Order

Archived

Designs can be promoted into an order draft.

5. Wishlist Module
Purpose

Track potential future products.

Wishlist Fields

Item name

Description

Proposed vendor

Estimated cost

Priority

Rationale / demand notes

Suggested retail price (optional)

Status (Idea / Reviewing / Approved / Rejected)

Wishlist items may be converted into:
→ Design entries
→ Order drafts

6. Scheduling & Notifications
Order Scheduling Fields

Requested by date

Expected arrival date

Vendor lead time (optional)

Reminder Rules

System should flag:

Approved but not ordered after X days

Orders past expected arrival date

Items received but not stocked

7. Attachments & File Management

Orders and designs must support:

Image uploads

PDF invoices

Screenshots

Quotes

Files stored with:

upload date

file type

linked entity

8. Search, Filtering & Export

Users must be able to:

Filter by:

Status

Vendor

Requester

Date range

Priority

Category

Search:

Item name

Notes

Vendor

Export:

CSV export of orders

Receiving logs

9. Permissions (v1 Open Access, Future-Ready)
v1

All users can create and edit

Future Roles

Viewer

Staff

Manager

Admin

Approval workflows can be enabled later.

10. Audit & Change Tracking

System should log:

Order edits

Status changes

Quantity adjustments

Receiving updates

Includes:

user

timestamp

change summary

11. Non-Functional Requirements
Performance

Order creation < 1 second

Inventory prompt generation < 2 seconds

Reliability

Orders cannot be deleted once submitted (archive instead)

Security

File uploads scanned & size limited

Activity account data editable only by admins

Data Integrity

Prevent duplicate open orders for same SKU/vendor

Maintain order history permanently

Future Enhancements (Not Required for v1)

Barcode scanning integration

Vendor price history analytics

Profit margin tracking

Sales trend–driven reorder recommendations

Slack/email notification integration

Mobile receiving workflow

Summary

This Product Dashboard centralizes purchasing, vendor coordination, inventory-driven ordering, and merchandise planning. It reduces manual tracking, prevents stockouts, improves accountability, and enables scalable operations for the CO-OP store.