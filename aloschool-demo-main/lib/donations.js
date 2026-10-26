// ---------- দান / সদকা / যাকাত (Donations) ----------
// মাদ্রাসাের ফি-লেজারের বাইরে আলাদা খাতা — দান কোনো তালিবুল ইলমর বকেয়ার সাথে যুক্ত নয়।
// যাকাত/সদকা বিশেষ খাতে ব্যয়যোগ্য অর্থ, তাই এগুলো ইচ্ছাকৃতভাবে ফি-আয়ের হিসাবে
// (ড্যাশবোর্ড চার্ট) মেশানো হয় না; আলাদা পেজে খাতভিত্তিক মোট দেখানো হয়।
//
// ডেটা: db key `donations` -> [ { id, receiptNo, date, donorName, phone, category, fund,
//        amount, method, note, createdAt } ]  (নতুন আগে)
// রশিদ নম্বর: DON-<বছর>-<৪ অঙ্কের ক্রম> (ফি রশিদের RCPT-এর মতোই বছরভিত্তিক কাউন্টার)।

const crypto = require("crypto");
const db = require("./db");

const KEY = "donations";

const CATEGORIES = ["দান", "সদকা", "যাকাত", "ফিতরা", "কুরবানির চামড়া", "অন্যান্য"];
// অর্থ কোন তহবিলে যাবে — "লিল্লাহ বোর্ডিং" তহবিলের দান বোর্ডিং হিসাবে লিল্লাহ খরচের পাশে দেখানো হয়।
const FUNDS = ["সাধারণ তহবিল", "লিল্লাহ বোর্ডিং", "নির্মাণ ও উন্নয়ন", "অন্যান্য"];
const LILLAH_FUND = "লিল্লাহ বোর্ডিং";
const METHODS = ["নগদ", "বিকাশ", "নগদ (Nagad)", "ব্যাংক", "চেক"];

function shortId() {
  return crypto.randomBytes(4).toString("hex");
}

async function listDonations() {
  return (await db.get(KEY)) || [];
}

async function nextReceiptNo() {
  const year = new Date().getFullYear();
  const counterKey = `donationReceipt:counter:${year}`;
  const counter = ((await db.get(counterKey)) || 0) + 1;
  await db.set(counterKey, counter);
  return `DON-${year}-${String(counter).padStart(4, "0")}`;
}

// ফেরত দেয় { ok: true, donation } অথবা { ok: false, error }
async function addDonation(input) {
  const i = input || {};
  const amount = Number(db.bnToEnDigits(i.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "টাকার পরিমাণ সঠিক নয়" };
  const category = CATEGORIES.includes(i.category) ? i.category : "";
  if (!category) return { ok: false, error: "খাত (দান/সদকা/যাকাত) নির্বাচন করুন" };
  const fund = FUNDS.includes(i.fund) ? i.fund : FUNDS[0];
  const date = db.bnToEnDigits(i.date || "").trim();
  const useDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) ? date : new Date().toISOString().slice(0, 10);
  const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
  const donorName = clip(i.donorName, 120) || "নাম প্রকাশে অনিচ্ছুক";

  const list = await listDonations();
  const donation = {
    id: shortId(),
    receiptNo: await nextReceiptNo(),
    date: useDate,
    donorName,
    phone: clip(i.phone, 30),
    category,
    fund,
    amount: Math.round(amount * 100) / 100,
    method: clip(i.method, 40),
    note: clip(i.note, 300),
    createdAt: Date.now(),
  };
  list.unshift(donation);
  await db.set(KEY, list);
  return { ok: true, donation };
}

async function getDonation(id) {
  return (await listDonations()).find((d) => d.id === id) || null;
}

async function deleteDonation(id) {
  const list = await listDonations();
  const next = list.filter((d) => d.id !== id);
  if (next.length !== list.length) await db.set(KEY, next);
  return list.length - next.length;
}

// month = "YYYY-MM" (ফাঁকা হলে সব সময়) — খাতভিত্তিক ও তহবিলভিত্তিক মোট।
function summarize(list) {
  const byCategory = {};
  const byFund = {};
  CATEGORIES.forEach((c) => (byCategory[c] = 0));
  FUNDS.forEach((f) => (byFund[f] = 0));
  let total = 0;
  for (const d of list) {
    const a = Number(d.amount) || 0;
    total += a;
    byCategory[d.category] = (byCategory[d.category] || 0) + a;
    byFund[d.fund] = (byFund[d.fund] || 0) + a;
  }
  return { total, byCategory, byFund, count: list.length };
}

async function listForMonth(month) {
  const list = await listDonations();
  if (!month) return list;
  return list.filter((d) => (d.date || "").startsWith(month));
}

module.exports = { CATEGORIES, FUNDS, LILLAH_FUND, METHODS, listDonations, listForMonth, addDonation, getDonation, deleteDonation, summarize };
