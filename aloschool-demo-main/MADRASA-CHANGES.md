# মাদ্রাসা রূপান্তর — পরিবর্তনের সারাংশ

- ডেটাবেস: এই অ্যাপ SQL নয়, key-value স্টোর (data/*.json বা Upstash Redis)। `hifz_daily_records` তাই lib/db.js-এ টেবিল-সদৃশ লেয়ার; SQL DDL: migrations/001_hifz_daily_records.sql
- নতুন: lib/hifz.js, lib/donations.js, views/hifz-daily-entry.ejs, hifz-student-report.ejs, admin-boarding.ejs, admin-donations.ejs
- রুট: GET/POST /hifz/daily-entry, GET /hifz/student/:id/report, /admin/boarding, /admin/donations (+ রশিদ PDF)
- উস্তাদরা /hifz/* ব্যবহার করতে পারেন (lib/auth.js)
- শব্দ বদল: শিক্ষক→উস্তাদ, শিক্ষার্থী→তালিবুল ইলম, ফলাফল/রেজাল্ট→মারহালা / মূল্যায়ন, ক্লাস/শ্রেণি→বিভাগ, স্কুল→মাদ্রাসা
- থিম: #047857
- বাকি: ক্লাস প্রমোশন (lib/promotion.js) স্ট্যান্ডার্ড গ্রেড নামের উপর নির্ভর করে — মাদ্রাসা বিভাগে কাজ করবে না
