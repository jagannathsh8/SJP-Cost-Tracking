# SJP MIS Dashboard

A beautiful, high-performance MIS Dashboard for Babai Tiffins, powered by Google Sheets and Apps Script.

![Dashboard Preview](https://cdn-icons-png.flaticon.com/512/1458/1458260.png)

## Features
- **Live Data Sync**: Fetches real-time data from Google Sheets using a custom Apps Script API.
- **Deep Analytics**: Rolling averages, cumulative revenue, and year-over-year comparisons.
- **PWA Ready**: Installable on mobile devices with offline caching support.
- **Multi-Sheet Support**: Easily switch between different months or outlets.
- **Intelligence Centre**: AI-powered analysis and automated message drafting for WhatsApp.

## Project Structure
- `/dashboard`: The frontend web application (HTML/JS).
- `/google-apps-script`: Backend logic for Google Sheets.
- `/tools`: Automation scripts for rebuilding or updating the dashboard.

## Setup Instructions

### 1. Google Sheets Setup
1. Create a copy of the [SJP MIS Template](YOUR_TEMPLATE_URL).
2. Open **Extensions > Apps Script**.
3. Copy the contents of `google-apps-script/code.gs` into the script editor.
4. Deploy as a **Web App**:
   - Execute as: `Me`
   - Who has access: `Anyone`
5. Copy the `/exec` URL.

### 2. Dashboard Deployment
1. Upload the files in the `/dashboard` folder to any static hosting (GitHub Pages, Vercel, or Netlify).
2. Open the dashboard in your browser.
3. Go to the **Data Source** tab and add your Apps Script URL.

### 3. Local Development
To rebuild the dashboard with new constants or logic:
1. Edit `dashboard/index.html`.
2. Run the update tool:
   ```bash
   node tools/update.js
   ```

## License
MIT License. See `LICENSE` for details.
