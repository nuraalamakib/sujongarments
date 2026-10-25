SUJAN GARMENTS V6.1
====================

WHAT CHANGED
------------
1. Mobile keyboard-safe viewport handling.
2. Modal height follows the visible viewport, so fields stay usable when the keyboard opens.
3. Offline-first data cache remains in IndexedDB (Dexie).
4. New entries save locally first; if offline they are queued and automatically sent to Google Sheets when online.
5. Offline edit/delete actions are also queued and synchronized later.
6. Google Sheet sync polling is approximately every 10 seconds while the app is visible and online.
7. Customer and Company are separate live mirror sheets, while Sheet1 remains the master sheet for compatibility.
8. New entries stay at the top (row 2).
9. Transaction ID remains the safety key for duplicate protection and edit/delete.
10. Service worker cache was cleaned up so the app does not depend on the old missing V6 offline HTML filename.
11. SweetAlert notifications are made compact/toast-style where appropriate; confirmations remain interactive.
12. Existing search, reports, PDF, charts, PIN, dark mode and other app features are retained.

DEPLOYMENT
----------
A) GOOGLE APPS SCRIPT
1. Open the Google Sheet used by the app.
2. Extensions -> Apps Script.
3. Replace the old backend code with:
   Sujan_Garments_V6.1_Backend.gs
4. Save.
5. Run testBackend() once and authorize if Google asks.
6. Run setupSeparateSheets() once.
   This creates/rebuilds:
      - Customer
      - Company
   Existing Sheet1 data is preserved.
7. Deploy -> New deployment -> Web app.
8. Execute as: Me
9. Who has access: use the same access setting as the existing working deployment.
10. If the deployment URL changes, update SCRIPT_URL inside index.html.

B) WEB HOSTING / PWA
Upload these files into the same folder:
   index.html
   manifest.json
   service-worker.js
   icon-192.png
   icon-512.png
   icon-512-maskable.png

HTTPS is recommended/required for service-worker/PWA behavior except local development environments.

C) IMPORTANT
Customer and Company sheets are mirrors generated from Sheet1.
The application writes transactions to Sheet1 first, then rebuilds the corresponding mirrors.
Do not manually type unrelated transactions into Customer/Company if you want the app's master ledger to remain authoritative.

REAL-TIME NOTE
---------------
Google Apps Script Web Apps do not provide a WebSocket/push channel to this PWA.
This version therefore uses immediate POST sync plus visible-app polling at about 10 seconds.
That is near-real-time for this architecture without changing the existing backend platform.

SAFETY
------
Sheet1 remains the master ledger and the original A:I transaction structure is preserved.
Edit changes only Amount (H).
Delete targets a row by Transaction ID and performs a final ID check before deleting.
