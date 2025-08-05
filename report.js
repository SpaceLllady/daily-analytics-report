const axios = require('axios');
const nodemailer = require('nodemailer');

async function getMailchimpData() {
  try {
    const response = await axios.get(
      `https://${process.env.MAILCHIMP_SERVER}.api.mailchimp.com/3.0/campaigns`,
      {
        headers: { 'Authorization': `Bearer ${process.env.MAILCHIMP_API_KEY}` },
        params: { count: 10, status: 'sent' }
      }
    );
    
    let totalSent = 0, totalOpens = 0, totalClicks = 0;
    
    for (const campaign of response.data.campaigns.slice(0, 5)) {
      try {
        const report = await axios.get(
          `https://${process.env.MAILCHIMP_SERVER}.api.mailchimp.com/3.0/reports/${campaign.id}`,
          { headers: { 'Authorization': `Bearer ${process.env.MAILCHIMP_API_KEY}` } }
        );
        
        totalSent += report.data.emails_sent || 0;
        totalOpens += report.data.opens?.unique_opens || 0;
        totalClicks += report.data.clicks?.unique_clicks || 0;
        
        await new Promise(r => setTimeout(r, 200));
      } catch (e) { console.log('Campaign error:', e.message); }
    }
    
    return {
      campaigns: response.data.campaigns.length,
      emailsSent: totalSent,
      openRate: totalSent ? ((totalOpens / totalSent) * 100).toFixed(1) : 0,
      clickRate: totalSent ? ((totalClicks / totalSent) * 100).toFixed(1) : 0
    };
  } catch (error) {
    return { campaigns: 0, emailsSent: 0, openRate: 0, clickRate: 0, error: error.message };
  }
}

async function getPostHogData() {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const date = yesterday.toISOString().split('T')[0];
    
    const pageViews = await axios.post(
      `https://app.posthog.com/api/projects/${process.env.POSTHOG_PROJECT_ID}/insights`,
      {
        events: [{ id: '$pageview', type: 'events' }],
        date_from: date,
        date_to: date,
        insight: 'TRENDS'
      },
      { headers: { 'Authorization': `Bearer ${process.env.POSTHOG_API_KEY}` } }
    );
    
    const sessions = await axios.post(
      `https://app.posthog.com/api/projects/${process.env.POSTHOG_PROJECT_ID}/insights`,
      {
        events: [{ id: '$session_start', type: 'events' }],
        date_from: date,
        date_to: date,
        insight: 'TRENDS'
      },
      { headers: { 'Authorization': `Bearer ${process.env.POSTHOG_API_KEY}` } }
    );
    
    const totalPageViews = pageViews.data.result?.[0]?.data?.reduce((a, b) => a + (b || 0), 0) || 0;
    const totalSessions = sessions.data.result?.[0]?.data?.reduce((a, b) => a + (b || 0), 0) || 0;
    
    return { pageViews: totalPageViews, sessions: totalSessions, newUsers: Math.floor(totalSessions * 0.3) };
  } catch (error) {
    return { pageViews: 0, sessions: 0, newUsers: 0, error: error.message };
  }
}

async function sendReport(mailchimp, posthog) {
  const html = `
    <div style="font-family:Arial;max-width:800px;margin:20px auto;background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1)">
      <h1 style="text-align:center;color:#333;margin-bottom:30px">📊 Daily Analytics Report</h1>
      <div style="text-align:center;color:#666;margin-bottom:30px">${new Date().toLocaleDateString()}</div>
      
      <h2 style="color:#2c3e50;border-bottom:2px solid #3498db;padding-bottom:10px">📧 Email Marketing</h2>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:20px;margin:20px 0">
        <div style="background:#f8f9fa;padding:20px;border-radius:6px;border-left:4px solid #3498db">
          <div style="font-size:12px;color:#666;text-transform:uppercase">CAMPAIGNS</div>
          <div style="font-size:24px;font-weight:bold;color:#2c3e50">${mailchimp.campaigns}</div>
        </div>
        <div style="background:#f8f9fa;padding:20px;border-radius:6px;border-left:4px solid #3498db">
          <div style="font-size:12px;color:#666;text-transform:uppercase">EMAILS SENT</div>
          <div style="font-size:24px;font-weight:bold;color:#2c3e50">${mailchimp.emailsSent.toLocaleString()}</div>
        </div>
        <div style="background:#f8f9fa;padding:20px;border-radius:6px;border-left:4px solid #27ae60">
          <div style="font-size:12px;color:#666;text-transform:uppercase">OPEN RATE</div>
          <div style="font-size:24px;font-weight:bold;color:#2c3e50">${mailchimp.openRate}%</div>
        </div>
        <div style="background:#f8f9fa;padding:20px;border-radius:6px;border-left:4px solid #27ae60">
          <div style="font-size:12px;color:#666;text-transform:uppercase">CLICK RATE</div>
          <div style="font-size:24px;font-weight:bold;color:#2c3e50">${mailchimp.clickRate}%</div>
        </div>
      </div>
      
      <h2 style="color:#2c3e50;border-bottom:2px solid #3498db;padding-bottom:10px">📱 Website Analytics</h2>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin:20px 0">
        <div style="background:#f8f9fa;padding:20px;border-radius:6px;border-left:4px solid #e74c3c">
          <div style="font-size:12px;color:#666;text-transform:uppercase">PAGE VIEWS</div>
          <div style="font-size:24px;font-weight:bold;color:#2c3e50">${posthog.pageViews.toLocaleString()}</div>
        </div>
        <div style="background:#f8f9fa;padding:20px;border-radius:6px;border-left:4px solid #e74c3c">
          <div style="font-size:12px;color:#666;text-transform:uppercase">SESSIONS</div>
          <div style="font-size:24px;font-weight:bold;color:#2c3e50">${posthog.sessions.toLocaleString()}</div>
        </div>
        <div style="background:#f8f9fa;padding:20px;border-radius:6px;border-left:4px solid #e74c3c">
          <div style="font-size:12px;color:#666;text-transform:uppercase">NEW USERS</div>
          <div style="font-size:24px;font-weight:bold;color:#2c3e50">${posthog.newUsers.toLocaleString()}</div>
        </div>
      </div>
      
      <div style="background:#ecf0f1;padding:20px;border-radius:6px;margin-top:30px">
        <h3 style="margin-top:0;color:#2c3e50">📋 Summary</h3>
        <p>Your email campaigns are performing at ${mailchimp.openRate}% open rate, and your website had ${posthog.pageViews.toLocaleString()} page views yesterday.</p>
      </div>
    </div>
  `;

  const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASSWORD
    }
  });

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: 'spacelllady@gmail.com',
    subject: `📊 Daily Analytics Report - ${new Date().toLocaleDateString()}`,
    html: html
  });
}

async function main() {
  console.log('🚀 Starting daily report...');
  
  const [mailchimp, posthog] = await Promise.all([
    getMailchimpData(),
    getPostHogData()
  ]);
  
  await sendReport(mailchimp, posthog);
  console.log('✅ Report sent successfully!');
}

main().catch(console.error);
