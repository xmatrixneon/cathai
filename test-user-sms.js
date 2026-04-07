// Test for user's specific SMS format
import { config } from "dotenv";
config();

const escapeRegex = (s = "") =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function normalizeToSingleLine(str = "") {
  return str
    .replace(/\r?\n|\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSmartOtpRegexList(formats) {
  if (!formats || formats.length === 0) return [];
  if (!Array.isArray(formats)) formats = [formats];

  return formats
    .map((format) => {
      format = normalizeToSingleLine(format);
      if (!format.includes("{otp}")) return null;

      let pattern = escapeRegex(format);

      let isFirstOtp = true;
      pattern = pattern.replace(/\\\{otp\\\}/gi, () => {
        if (isFirstOtp) {
          isFirstOtp = false;
          return "(?<otp>[A-Za-z0-9\\-]{3,20})";
        }
        return "(?:[A-Za-z0-9\\-]{3,20})";
      });

      pattern = pattern.replace(/\\\{date\\\}/gi, ".*");
      pattern = pattern.replace(/\\\{datetime\\\}/gi, ".*");
      pattern = pattern.replace(/\\\{time\\\}/gi, ".*");
      pattern = pattern.replace(/\\\{duration\\\}/gi, ".*");
      pattern = pattern.replace(/\\\{random\\\}/gi, "[A-Za-z0-9]{3,20}");
      pattern = pattern.replace(/\\\{url\\\}/gi, "\\S+");
      pattern = pattern.replace(/\\\{link\\\}/gi, "\\S+");
      pattern = pattern.replace(/\\\{phone\\\}/gi, "[+]?[0-9\\-]{8,15}");
      pattern = pattern.replace(/\\\{email\\\}/gi, "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}");
      pattern = pattern.replace(/\\\{id\\\}/gi, "[A-Za-z0-9\\-]{5,30}");
      pattern = pattern.replace(/\\\{name\\\}/gi, "[A-Za-z\\s]{2,30}");
      pattern = pattern.replace(/\\\{amount\\\}/gi, "[$€£₹₽]?[0-9.,]+[A-Z]*(?:\\s?(?:USD|EUR|GBP|INR|Rs)?)?");
      pattern = pattern.replace(/\\\{digits\\\}/gi, "\\d{3,15}");
      pattern = pattern.replace(/\\\{number\\\}/gi, "\\d+");
      pattern = pattern.replace(/\\\{any\\\}/gi, ".*");
      pattern = pattern.replace(/\\\{.*?\\\}/gi, ".*");

      pattern = pattern
        .replace(/\\s+/g, "\\s*")
        .replace(/\\:/g, "[:：]?");

      // Smarter dot replacement
      pattern = pattern
        .replace(/\\\.$/g, ".*")
        .replace(/\\\.\s+(?=[A-Z])|\\\.\s*$|\\\.\s*-----/g, "\\.\\s*")
        .replace(/\\\./g, "\\.");

      return new RegExp(pattern, "i");
    })
    .filter(Boolean);
}

// User's SMS
const userSMS = "875678 is your one-time password (OTP) for phone verification to login at Testbook. y9ncH3XfU2q";

console.log("=== Testing User's SMS Format ===\n");
console.log(`SMS: "${userSMS}"\n`);

// Test different template variations
const templates = [
  {
    name: "Template with {any} at end",
    template: "{otp} is your one-time password (OTP) for phone verification to login at Testbook. {any}",
    expected: "875678"
  },
  {
    name: "Template with {random} at end",
    template: "{otp} is your one-time password (OTP) for phone verification to login at Testbook. {random}",
    expected: "875678"
  },
  {
    name: "Template without end part",
    template: "{otp} is your one-time password (OTP) for phone verification to login at Testbook.",
    expected: "875678"
  }
];

for (const test of templates) {
  console.log(`📋 Test: ${test.name}`);
  console.log(`   Template: "${test.template}"`);

  const regexList = buildSmartOtpRegexList(test.template);
  const cleanMessage = normalizeToSingleLine(userSMS);

  let otpFound = null;
  for (const regex of regexList) {
    const match = regex.exec(cleanMessage);
    otpFound = match?.groups?.otp || (match && match[1]) || null;
    if (otpFound) break;
  }

  if (otpFound === test.expected) {
    console.log(`   ✅ PASS - Extracted: "${otpFound}"\n`);
  } else {
    console.log(`   ❌ FAIL - Expected: "${test.expected}", Got: "${otpFound}"`);
    // Show the regex for debugging
    if (regexList.length > 0) {
      console.log(`   Regex: ${regexList[0]}`);
    }
    console.log();
  }
}

// Test the generated regex in detail
console.log("=== Detailed Regex Analysis ===\n");
const template = "{otp} is your one-time password (OTP) for phone verification to login at Testbook. {any}";
const regex = buildSmartOtpRegexList(template)[0];
console.log(`Template: "${template}"`);
console.log(`Generated Regex: ${regex}`);
console.log();

const cleanMessage = normalizeToSingleLine(userSMS);
console.log(`Clean Message: "${cleanMessage}"`);
console.log();

const match = regex.exec(cleanMessage);
if (match) {
  console.log(`Match found:`);
  console.log(`  Full match: "${match[0]}"`);
  console.log(`  OTP group: "${match.groups?.otp}"`);
  console.log(`  Match index: ${match.index}`);
  console.log(`  Match length: ${match[0].length}`);
} else {
  console.log(`No match found!`);
}
