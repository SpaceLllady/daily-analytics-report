const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { getMailchimpData, getPostHogData } = require('./report');

test('getMailchimpData returns zero metrics on error', async () => {
  const originalGet = axios.get;
  axios.get = async () => { throw new Error('failure'); };
  const result = await getMailchimpData();
  assert.deepStrictEqual(result, {
    campaigns: 0,
    emailsSent: 0,
    openRate: 0,
    clickRate: 0,
    error: 'failure'
  });
  axios.get = originalGet;
});

test('getPostHogData returns zero metrics on error', async () => {
  const originalPost = axios.post;
  axios.post = async () => { throw new Error('oops'); };
  const result = await getPostHogData();
  assert.deepStrictEqual(result, {
    pageViews: 0,
    sessions: 0,
    newUsers: 0,
    error: 'oops'
  });
  axios.post = originalPost;
});
