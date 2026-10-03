// src/config/reportI18n.js
//
// English / Urdu text for the Haji Sahab report. Heads are your own data, so
// only common ones are translated here; anything else can be given an Urdu
// name per head or section in Customize. Language is a layout option:
//   "en"   English only
//   "ur"   Urdu only (falls back to English where no Urdu name exists)
//   "both" "English · اردو"

export const LANGS = [
  { id: "en", label: "English" },
  { id: "ur", label: "اردو (Urdu)" },
  { id: "both", label: "English + اردو" },
];

const STR = {
  title: ["Monthly Statement", "ماہانہ گوشوارہ"],
  yearTitle: ["Yearly Statement", "سالانہ گوشوارہ"],
  opening: ["Opening balance", "ابتدائی بیلنس"],
  closing: ["Closing balance", "اختتامی بیلنس"],
  income: ["Income", "آمدن"],
  expense: ["Expense", "اخراجات"],
  totalIncome: ["Total income", "کل آمدن"],
  totalExpense: ["Total expense", "کل اخراجات"],
  surplus: ["Net surplus", "خالص بچت"],
  deficit: ["Net deficit", "خالص خسارہ"],
  net: ["Net", "خالص"],
  accounts: ["Bank & Cash accounts", "بینک اور نقد اکاؤنٹس"],
  account: ["Account", "اکاؤنٹ"],
  colOpening: ["Opening", "ابتدائی"],
  colIn: ["Money in", "آمد"],
  colOut: ["Money out", "اخراج"],
  colClosing: ["Closing", "اختتامی"],
  budget: ["Budget", "بجٹ"],
  outstanding: ["Outstanding", "بقایا جات"],
  pendingFees: ["Pending fees", "بقایا فیس"],
  unpaidSalaries: ["Unpaid salaries", "غیر ادا شدہ تنخواہیں"],
  notCounted: ["not counted", "شمار نہیں"],
  total: ["Total", "کل"],
  generated: ["Generated", "تیار کردہ"],
  closed: ["Closed", "بند"],
  scopeAll: ["All branches", "تمام شاخیں"],
};

export const MONTHS_UR = ["جنوری", "فروری", "مارچ", "اپریل", "مئی", "جون", "جولائی", "اگست", "ستمبر", "اکتوبر", "نومبر", "دسمبر"];

// Built-in sections and common heads, keyed by lower-cased English label.
const UR = {
  "fee income": "فیس کی آمدن", "donations & welfare": "عطیات اور فلاح", "loans & advances": "قرض اور پیشگی",
  "other income": "دیگر آمدن", "salaries & staff": "تنخواہیں اور عملہ", "rent & utilities": "کرایہ اور یوٹیلیٹیز",
  "maintenance & equipment": "مرمت اور سامان", "supplies & printing": "سامان اور چھپائی",
  "meals & hospitality": "کھانا اور مہمان نوازی", "transport & fuel": "ٹرانسپورٹ اور ایندھن",
  "welfare & charity": "فلاح و خیرات", "other expenses": "دیگر اخراجات",
  "tuition fee": "ٹیوشن فیس", "registration fee": "رجسٹریشن فیس", "admission fees": "داخلہ فیس", "admission fee": "داخلہ فیس",
  "exam fee": "امتحانی فیس", "transport fee": "ٹرانسپورٹ فیس", "tafseer course fees": "تفسیر کورس فیس",
  "donation": "عطیہ", "welfare": "فلاح", "loan": "قرض", "loan return": "قرض کی واپسی", "salary advance": "تنخواہ پیشگی",
  "utilities": "یوٹیلیٹیز", "electricity": "بجلی", "gas": "گیس", "rent": "کرایہ",
  "salaries": "تنخواہیں", "staff salaries (payroll)": "عملے کی تنخواہیں",
  "lunch": "لنچ", "maintenance": "مرمت", "stationery": "اسٹیشنری", "supplies": "سامان", "transport": "ٹرانسپورٹ", "fuel": "ایندھن",
  "entertainment": "مہمان نوازی", "cleaning & laundry": "صفائی اور دھلائی", "phone package": "فون پیکج",
  "drinking water": "پینے کا پانی", "furniture & fixture": "فرنیچر اور فکسچر", "printing & designing": "چھپائی اور ڈیزائننگ",
  "gifts": "تحائف", "miscellaneous": "متفرق", "other": "دیگر", "suspense": "سسپینس", "fee collection": "فیس وصولی",
};

export const isRtl = (lang) => lang === "ur";

// Combine an English label and its Urdu counterpart for the chosen language.
export function pick(lang, en, ur) {
  if (lang === "ur") return ur || en;
  if (lang === "both") return ur && ur !== en ? `${en} · ${ur}` : en;
  return en;
}

export const tr = (lang, key) => pick(lang, STR[key][0], STR[key][1]);

export const builtinUrdu = (label) => UR[String(label || "").trim().toLowerCase()] || "";

export function periodLabel(lang, year, month, enLabel) {
  if (lang === "en") return enLabel;
  const ur = `${MONTHS_UR[month - 1]} ${year}`;
  return lang === "ur" ? ur : `${enLabel} · ${ur}`;
}

export const monthLabel = (lang, month, enName) => pick(lang, enName, MONTHS_UR[month - 1]);
