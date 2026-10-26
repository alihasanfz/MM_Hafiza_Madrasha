// ---------- হিফজ দৈনিক সবক ট্র্যাকার — সহায়ক ফাংশন ----------
// রুট (server.js) যেন পাতলা থাকে, তাই রোস্টার লোড, অ্যাক্সেস নিয়ম আর রিপোর্টের
// হিসাব এখানে। ডেটার আসল "টেবিল" lib/db.js-এর hifzDailyRecords।

const db = require("./db");
const attendance = require("./attendance");

const RATINGS = db.HIFZ_RATINGS; // মুমতাজ, জায়্যিদ জিদ্দান, জায়্যিদ, মাকবুল

// রেটিং -> বাজে/ভালো বোঝাতে রং ও ছোট কোড (পিল ও রিপোর্টে)
const RATING_META = {
  "মুমতাজ": { color: "#047857", bg: "#d1fae5", short: "ম" },
  "জায়্যিদ জিদ্দান": { color: "#0f766e", bg: "#ccfbf1", short: "জজ" },
  "জায়্যিদ": { color: "#b45309", bg: "#fef3c7", short: "জ" },
  "মাকবুল": { color: "#b91c1c", bg: "#fee2e2", short: "মা" },
};

// ঢাকার তারিখ (UTC+6)। attendance.todayStr() UTC ধরে — ফজরের পর (ভোর ০০:০০–০৬:০০ ঢাকা সময়)
// সবক তোলার সময় সেটা গতকালের তারিখ দিত, তাই হিফজে নিজস্ব ফাংশন।
function todayStr() {
  return new Date(Date.now() + 6 * 3600 * 1000).toISOString().slice(0, 10);
}

function isValidDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(s));
}

function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

// কোন বিভাগ/বিভাগ এই ব্যবহারকারী দেখতে-লিখতে পারবেন।
//  - অ্যাডমিন: সব বিভাগ
//  - উস্তাদ: যে বিভাগের বিভাগ-উস্তাদ হিসেবে নির্ধারিত, শুধু সেগুলো;
//    কোনো নির্ধারণ না থাকলে সব বিভাগ (যাতে সেটআপের আগেই কাজ শুরু করা যায়)।
async function allowedClassesFor(staff, allClasses) {
  if (!staff || staff.role === "admin") return allClasses;
  const session = await attendance.getCurrentSession();
  const assignments = await attendance.findTeacherAssignments(session, staff.id);
  const slugs = new Set(assignments.map((a) => a.classSlug));
  if (slugs.size === 0) return allClasses;
  return allClasses.filter((c) => slugs.has(c.slug));
}

// আইডি দিয়ে তালিবুল ইলম খোঁজে (সব বিভাগে ঘুরে)।
async function findStudent(studentId) {
  const classes = (await db.get("classlist")) || [];
  for (const cls of classes) {
    const roster = (await db.get(`students:${cls.slug}`)) || [];
    const student = roster.find((s) => s.id === studentId);
    if (student) return { student, cls };
  }
  return null;
}

function sortRoster(roster) {
  return roster.slice().sort((a, b) => String(a.roll || "").localeCompare(String(b.roll || ""), "bn", { numeric: true }));
}

// একটি বিভাগের সক্রিয় তালিবুল ইলম + ওই তারিখের রেকর্ড + শেষ জানা পারা (প্রিফিলের জন্য)।
async function rosterWithRecords(classSlug, date) {
  const session = await attendance.getCurrentSession();
  const roster = (await db.get(`students:${classSlug}`)) || [];
  const students = sortRoster(attendance.activeRosterFor(roster, session));
  const rows = await Promise.all(
    students.map(async (student) => {
      const all = await db.hifzDailyRecords.listByStudent(student.id); // নতুন আগে
      const today = all.find((r) => r.entry_date === date) || null;
      const previous = all.find((r) => r.entry_date < date) || null;
      return { student, record: today, lastParaNo: previous ? previous.para_no : null, lastSabaq: previous ? previous.sabaq : "" };
    })
  );
  return rows;
}

// রিপোর্টের সারাংশ — records নতুন-আগে সাজানো থাকতে হবে।
function summarize(records) {
  const ratingCounts = {};
  RATINGS.forEach((r) => (ratingCounts[r] = 0));
  let rated = 0;
  records.forEach((r) => {
    if (r.rating && ratingCounts[r.rating] !== undefined) {
      ratingCounts[r.rating] += 1;
      rated += 1;
    }
  });
  const parasTouched = Array.from(new Set(records.map((r) => r.para_no))).sort((a, b) => a - b);
  const withSabaq = records.filter((r) => r.sabaq).length;
  return {
    days: records.length,
    withSabaq,
    rated,
    ratingCounts,
    parasTouched,
    currentPara: records.length ? records[0].para_no : null,
    highestPara: records.length ? Math.max(...records.map((r) => r.para_no)) : null,
  };
}

module.exports = { RATINGS, RATING_META, todayStr, isValidDate, addDays, allowedClassesFor, findStudent, rosterWithRecords, summarize };
