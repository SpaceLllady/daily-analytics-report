// scripts/report.js
// Requirements: npm i axios nodemailer
const axios = require('axios');
const nodemailer = require('nodemailer');

/** ========= Utilities ========= **/

function assertEnv(name) {
  if (!process.env[name] || String(process.env[name]).trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function fmtDate(d = new Date()) {
  // YYYY-MM-DD for APIs, and localized for email
  const iso = d.toISOString().split('T')[0];
  const human = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return { iso, human };
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** ========= Mailchimp ========= **/

function mailchimpHeaders() {
  // Mailchimp expects Basic auth with anystring:API_KEY (base64)
  assertEnv('MAILCHIMP_API_KEY');
  const token = Buffer.from(`anystring:${process.env.MAILCHIMP_API_KEY}`).toString('base64');
  return {
    Authorization: `Basic ${token}`,
  };
}

function mailchimpBase() {
  assertEnv('MAILCHIMP_SERVER'); // e.g. us21
  return `https://${process.env.MAILCHIMP_SERVER}.api.mailchimp.com/3.0`;
}

async function getMailchimpData() {
  try {
    const base = mailchimpBase();
    const headers = mailchimpHeaders();

    const { data } = await axios.get(`${base}/campaigns`, {
      headers,
      params: { count: 10, status: 'sent' },
    });

    const campaigns = Array.isArray(data?.campaigns) ? data.campaigns : [];
    let totalSent = 0;
    let totalOpens = 0;
    let totalClicks = 0;

    for (const campaign of campaigns.slice(0, 5)) {
      try {
        const { data: rep } = await axios.get(`${base}/reports/${campaign.id}`, { headers });
        totalSent += rep?.emails_sent || 0;
        totalOpens += rep?.opens?.unique_opens || 0;
        totalClicks += rep?.clicks?.unique_clicks || 0;
        await sleep(200); // gentle pacing
      } catch (e) {
        const status = e.response?.status;
        console.log(`Mailchimp report fetch failed for ${campaign?.id} (${status || e.message})`);
      }
    }

    const openRate = totalSent ? ((totalOpens / totalSent) * 100).toFixed(1) : '0.0';
    const clickRate = totalSent ? ((totalClicks / totalSent) * 100).toFixed(1) : '0.0';

    return {
      campaigns: campaigns.length,
      emailsSent: totalSent,
      openRate,
      clickRate,
    };
  } catch (error) {
    return { campaigns: 0, emailsSent: 0, openRate: '0.0', clickRate: '0.0', error: error.message };
  }
}

/** ========= PostHog ========= **/

function posthogConfig() {
  const host = process.env.POSTHOG_HOST || 'https://app.posthog.com';
  assertEnv('POSTHOG_API_KEY');
  assertEnv('POSTHOG_PROJECT_ID');
  return {
    host,
    projectId: process.env.POSTHOG_PROJECT_ID,
    headers: {
      Authorization: `Bearer ${process.env.POSTHOG_API_KEY}`,
      'Content-Type': 'application/json',
    },
  };
}

async function phTrendSum(host, projectId, headers, event, date) {
  const body = {
    events: [{ id: event, type: 'events' }],
    date_from: date,
    date_to: date,
    insight: 'TRENDS',
  };
  const { data } = await axios.post(`${host}/api/projects/${projectId}/insights`, body, { headers });
  const series = data?.result?.[0]?.data || [];
  return series.reduce((a, b) => a + (b || 0), 0);
}

async function getPostHogData() {
  try {
    const cfg = posthogConfig();
    // Use "yesterday" so a full day is captured
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const { iso: date } = fmtDate(y);

    const [pageViews, sessions] = await Promise.all([
      phTrendSum(cfg.host, cfg.projectId, cfg.headers, '$pageview', date),
      phTrendSum(cfg.host, cfg.projectId, cfg.headers, '$session_start', date),
    ]);

    // You can replace this with a real "new users" metric if you track it
    const newUsers = Math.floor(sessions * 0.3);

    return { pageViews, sessions, newUsers };
  } catch (error) {
    return { pageViews: 0, sessions: 0, newUsers: 0, error: error.message };
  }
}

/** ========= Email ========= **/

function makeHtml(mailchimp, posthog) {
  const now = new Date();
  const { human } = fmtDate(now);

  const safe = (n) => (typeof n === 'number' ? n : Number(n || 0));
  const mcOpen = typeof mailchimp.openRate === 'string' ? mailchimp.openRate : String(mailchimp.openRate || '0.0');
  const mcClick = typeof mailchimp.clickRate === 'string' ? mailchimp.clickRate : String(mailchimp.clickRate || '0.0');

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:800px;margin:20px auto;background:#ffffff;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.08)">
    <h1 style="text-align:center;color:#111;margin-bottom:8px">📊 Daily Analytics Report</h1>
    <div style="text-align:center;color:#555;margin-bottom:24px">${human}</div>

    <h2 style="color:#1f2937;border-bottom:2px solid #3b82f6;padding-bottom:8px;margin:24px 0 12px">📧 Email Marketing</h2>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px">
      <div style="background:#f9fafb;padding:16px;border-radius:6px;border-left:4px solid #3b82f6">
        <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Campaigns (last 10)</div>
        <div style="font-size:24px;font-weight:700;color:#111827">${safe(mailchimp.campaigns)}</div>
      </div>
      <div style="background:#f9fafb;padding:16px;border-radius:6px;border-left:4px solid #3b82f6">
        <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Emails Sent (sum of last 5)</div>
        <div style="font-size:24px;font-weight:700;color:#111827">${safe(mailchimp.emailsSent).toLocaleString()}</div>
      </div>
      <div style="background:#f9fafb;padding:16px;border-radius:6px;border-left:4px solid #10b981">
        <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Open Rate</div>
        <div style="font-size:24px;font-weight:700;color:#111827">${mcOpen}%</div>
      </div>
      <div style="background:#f9fafb;padding:16px;border-radius:6px;border-left:4px solid #10b981">
        <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Click Rate</div>
        <div style="font-size:24px;font-weight:700;color:#111827">${mcClick}%</div>
      </div>
    </div>

    <h2 style="color:#1f2937;border-bottom:2px solid #3b82f6;padding-bottom:8px;margin:28px 0 12px">🌐 Website Analytics (Yesterday)</h2>
    <div style=

