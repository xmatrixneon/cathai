import { NextResponse } from 'next/server';
import OpenAI from 'openai';

// Copy functions from fetch.mjs
const escapeRegex = (s = "") =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function normalizeToSingleLine(str = "") {
  return str
    .replace(/\r?\n|\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Enhanced OTP regex with more flexible patterns
function buildSmartOtpRegexList(formats) {
  if (!formats || formats.length === 0) return [];
  if (!Array.isArray(formats)) formats = [formats];

  return formats
    .map((format) => {
      format = normalizeToSingleLine(format);
      if (!format.includes("{otp}")) return null;

      let pattern = escapeRegex(format);

      // First {otp} gets named capture group, subsequent ones get non-capturing group
      let isFirstOtp = true;
      pattern = pattern.replace(/\\\{otp\\\}/gi, () => {
        if (isFirstOtp) {
          isFirstOtp = false;
          // Enhanced OTP pattern: handles alphanumeric, dash-separated, and various formats
          return "(?<otp>[A-Za-z0-9\\-]{3,20})";
        }
        return "(?:[A-Za-z0-9\\-]{3,20})";
      });

      // Enhanced placeholder support
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

      // ✅ Smarter dot replacement: only replace dots that are truly sentence endings
      // Don't replace dots in URLs, abbreviations, or other contexts
      pattern = pattern
        // Replace dots at end of string (like "-----ORGEN" suffix)
        .replace(/\\\.$/g, ".*")
        // Replace dots followed by space + capital letter (sentence endings)
        .replace(/\\\.\s+(?=[A-Z])|\\\.\s*$|\\\.\s*-----/g, "\\.\\s*")
        // Keep all other dots as literal (for URLs, abbreviations, etc.)
        .replace(/\\\./g, "\\.");

      return new RegExp(pattern, "i");
    })
    .filter(Boolean);
}

// Smart OTP detection using AI - no hardcoded patterns
// This will be called only for initial hint, AI will do the real work
function detectOtpInMessage(message) {
  // Simple heuristic: find the most likely 4-8 digit number
  // Prefer numbers near OTP-related words
  const words = message.toLowerCase().split(/\s+/);
  const otpWords = ['otp', 'code', 'verification', 'password', 'pin', 'login'];

  // Find sentences with OTP-related words
  const sentences = message.split(/[.!?]+/);

  for (const sentence of sentences) {
    const lowerSentence = sentence.toLowerCase();
    if (otpWords.some(w => lowerSentence.includes(w))) {
      // Extract 4-8 digit number from this sentence
      const match = sentence.match(/\b(\d{4,8})\b/);
      if (match) return match[1];
      // Try alphanumeric
      const alphaMatch = sentence.match(/\b([A-Za-z0-9]{3,12})\b/);
      if (alphaMatch) return alphaMatch[1];
    }
  }

  // Fallback: first 4-8 digit number in message
  const fallbackMatch = message.match(/\b(\d{4,8})\b/);
  return fallbackMatch ? fallbackMatch[1] : null;
}

const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
});

export async function POST(request) {
  try {
    const { smsText } = await request.json();

    if (!smsText) {
      return NextResponse.json({ error: 'SMS text is required' }, { status: 400 });
    }

    // Pre-detect OTP for better guidance
    const detectedOtp = detectOtpInMessage(smsText);

    // Function to validate template against SMS
    const validateTemplate = (template, smsText) => {
      // First check if template has exactly one {otp} placeholder
      const otpCount = (template.match(/{otp}/gi) || []).length;
      if (otpCount === 0) {
        return { valid: false, reason: 'No {otp} placeholder found in template' };
      }
      if (otpCount > 1) {
        return { valid: false, reason: 'Template contains multiple {otp} placeholders. Only one {otp} placeholder is allowed per template.' };
      }

      const regexList = buildSmartOtpRegexList(template);
      if (regexList.length === 0) {
        return { valid: false, reason: 'Failed to build regex from template' };
      }

      const cleanMessage = normalizeToSingleLine(smsText);
      let otpFound = null;

      for (const regex of regexList) {
        try {
          const match = regex.exec(cleanMessage);
          otpFound = match?.groups?.otp || (match && match[1]) || null;
          if (otpFound) {
            break;
          }
        } catch (error) {
          return { valid: false, reason: `Regex error: ${error.message}` };
        }
      }

      if (!otpFound) {
        return { valid: false, reason: 'Could not extract OTP from SMS using the generated template' };
      }

      return { valid: true, otp: otpFound };
    };

    let template;
    let validationResult;
    let attempts = 0;
    const maxAttempts = 8;

    do {
      attempts++;

      const prompt = `
You are an expert SMS template generator. Convert the following SMS message into a template using specific placeholder rules. The template MUST be compatible with our regex builder system and MUST successfully extract the OTP from the SMS.

=== CRITICAL RULES ===
1. You MUST use exactly ONE {otp} placeholder in the entire template
2. Replace ONLY the actual OTP CODE/NUMBER with {otp} - NOT the word "OTP" when it appears as text
3. The word "OTP", "code", "password" in the message text should be preserved as-is
4. If the actual OTP number appears multiple times, use {any} for subsequent occurrences
5. Match the SMS structure EXACTLY - preserve all punctuation, spacing, and static text
6. IMPORTANT: Unusual suffixes like "-----ORGEN", random codes, or sender signatures at the end should be replaced with {any}

=== PLACEHOLDERS AVAILABLE ===
Primary:
- {otp} → Use ONLY for the actual OTP code/number (alphanumeric, 3-20 chars) - REQUIRED (use exactly once)

For dynamic content:
- {digits} → Pure numbers only (phone numbers, numeric codes)
- {random} → Alphanumeric random strings without special characters
- {time} / {duration} → Time durations like "5 min", "100 secs", "24 hours"
- {date} / {datetime} → Dates and timestamps
- {url} / {link} → URLs and web links
- {phone} → Phone numbers with +, -, spaces
- {email} → Email addresses
- {id} → Transaction IDs, order IDs, reference numbers (alphanumeric)
- {name} → Person names
- {amount} → Money amounts like "$10.50", "100 INR", "50.00"
- {number} → Any numeric value
- {any} → Fallback for anything else

=== HOW TO IDENTIFY THE OTP ===
The OTP is usually:
- A 4-8 digit number near words like "OTP", "code", "verification", "password"
- Sometimes alphanumeric (ABC123, XY99Z)
- Can be dash-separated (123-456)
- Appears at the beginning or middle of the message
- Is NOT the word "OTP" itself - that's just a label

=== EXAMPLES ===

Example 1 - Simple numeric OTP:
SMS: "Your verification code is 123456. Valid for 10 minutes."
Template: "Your verification code is {otp}. Valid for {time}."

Example 2 - OTP with repeated value:
SMS: "Dear customer, 5672 is the one Time Password from Vi. Expires in 3 min. OTP @www.myvi.in #5672"
Template: "Dear customer, {otp} is the one Time Password from Vi. Expires in {time}. OTP @{url} #{any}"

Example 3 - OTP word appears multiple times, value appears once:
SMS: "341722 is your One time password (OTP) to login to MyJio. Don't share OTP with anyone. Please enter the OTP to proceed."
Template: "{otp} is your One time password (OTP) to login to MyJio. Don't share OTP with anyone. Please enter the OTP to proceed."

Example 4 - Complex with URL and reference:
SMS: "<#> 1770 is your OTP for Amazon login. Valid for 5 mins. Don't share. Call 1800-123-4567 for help. Ref: ABC123XYZ"
Template: "<#> {otp} is your OTP for Amazon login. Valid for {time}. Don't share. Call {phone} for help. Ref: {id}"

Example 5 - Alphanumeric OTP:
SMS: "Your access code is AB92X1. This code expires in 15 minutes. Do not share."
Template: "Your access code is {otp}. This code expires in {time}. Do not share."

Example 6 - With transaction ID:
SMS: "OTP to authorize txn of $50.00 at STORE is 789456. Transaction ID: TXN123456789"
Template: "OTP to authorize txn of {amount} at STORE is {otp}. Transaction ID: {id}"

Example 7 - With link:
SMS: "Verify your account: 456789 is your code. Visit https://example.com/verify if you didn't request this."
Template: "Verify your account: {otp} is your code. Visit {url} if you didn't request this."

Example 8 - Multiple IDs and numbers:
SMS: "Your Uber OTP is 2847. Request for ride to 123 Main St. Driver: John D. Trip ID: 4567890123"
Template: "Your Uber OTP is {otp}. Request for ride to {number} {id}. Driver: {name}. Trip ID: {id}"

Example 9 - OTP at start with unusual suffix:
SMS: "471154 is your OTP for login/signup. Valid for 5 mins. Do not share. -----ORGEN"
Template: "{otp} is your OTP for login/signup. Valid for {time}. Do not share. {any}"

Example 10 - OTP with sender signature:
SMS: "123456 is your verification code. Valid 10 minutes. - Sent by MyBank"
Template: "{otp} is your verification code. Valid {time}. {any}"

Example 11 - Complex format with hash:
SMS: "<#> 1770 is your OTP to login into Airtel Thanks app. Valid for 100 secs. Do not share with anyone. If this was not you click i.airtel.in/Contact N9BWuqauU1y"
Template: "<#> {otp} is your OTP to login into Airtel Thanks app. Valid for {time}. Do not share with anyone. If this was not you click {url} {any}"

${detectedOtp ? `\n=== HINT: I detected "${detectedOtp}" as the likely OTP. Replace this with {otp} ===` : ''}

${validationResult && !validationResult.valid ? `
=== PREVIOUS ATTEMPT FAILED ===
Error: ${validationResult.reason}

${validationResult.reason.includes('multiple')
  ? 'The template had multiple {otp} placeholders. Remember: ONLY the actual OTP code gets {otp}, not the word "OTP" or other numbers.'
  : validationResult.reason.includes('No {otp}')
  ? 'The template had no {otp} placeholder. You must identify and replace the OTP code with {otp}.'
  : 'The template could not extract the OTP. Check that:\n1. You replaced the correct OTP code with {otp}\n2. You preserved all static text exactly\n3. You used appropriate placeholders for dynamic content'}

=== FIX IT NOW ===
- Find the actual OTP code in the SMS (usually 4-8 digits, near "OTP", "code", "verification")
- Replace ONLY that code with {otp}
- Keep all other numbers/IDs using appropriate placeholders ({digits}, {id}, {number}, etc.)
- Preserve all text exactly as-is
` : ''}

=== YOUR TASK ===
Convert this SMS to a template:
"${smsText}"

Return ONLY the template string, nothing else. No explanations, no markdown, no quotes around the answer.
`;

      const completion = await openai.chat.completions.create({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: `You are an expert SMS template generator. Return ONLY the template string, no explanations, no markdown formatting.

CRITICAL REMINDERS:
1. Replace ONLY the actual OTP code/number with {otp} (NOT the word "OTP")
2. Use exactly ONE {otp} placeholder
3. Preserve all static text exactly
4. Use appropriate placeholders for dynamic content
5. Common OTPs are 4-8 digit numbers, sometimes alphanumeric
6. The word "OTP" in the message is just a label - keep it as-is

Output format: Just the template string, nothing else.`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_completion_tokens: 1500,
        temperature: 0.7,
      });

      template = completion.choices[0]?.message?.content?.trim();

      if (!template) {
        console.error('OpenAI API completion response:', JSON.stringify(completion, null, 2));
        throw new Error(`Failed to generate template. API response: ${completion.choices?.length || 0} choices returned`);
      }

      // Clean the template - remove markdown formatting, quotes, etc.
      template = template
        .replace(/^```[\s\S]*?\n?/, '') // Remove code blocks
        .replace(/^Template:\s*/i, '') // Remove "Template:" prefix
        .replace(/^["'`]|["'`]$/g, '') // Remove surrounding quotes
        .replace(/^```$/, '') // Remove trailing code block markers
        .trim();

      // Validate the generated template
      validationResult = validateTemplate(template, smsText);

    } while (!validationResult.valid && attempts < maxAttempts);

    if (!validationResult.valid) {
      let assistantExplanation = '';

      if (validationResult.reason.includes('multiple')) {
        assistantExplanation = `The AI kept generating templates with multiple {otp} placeholders.

Quick fix: Manually create your template by:
1. Finding the OTP in your SMS (usually near words like "OTP", "code", "verify")
2. Replace ONLY that number/code with {otp}
3. Keep everything else exactly the same

Example: If SMS is "Your OTP is 123456. Valid for 5 min."
Template: "Your OTP is {otp}. Valid for {time}."`;

      } else if (validationResult.reason.includes('No {otp}')) {
        assistantExplanation = `The AI couldn't identify the OTP in your SMS.

To manually create a template:
1. Look for a 4-8 digit number (or alphanumeric code)
2. It's usually near words like: OTP, code, verification, password, PIN
3. Replace that number with {otp}

Common OTP patterns to look for:
- "123456" (6 digits)
- "AB123" (alphanumeric)
- "123-456" (dash-separated)`;

      } else if (validationResult.reason.includes('Could not extract')) {
        assistantExplanation = `The template looks correct but our regex couldn't extract the OTP.

This might be a complex format. You can:
1. Try simplifying the template
2. Check if the OTP has unusual characters
3. Contact support with your exact SMS text for custom template creation

For reference, your SMS was: "${smsText.substring(0, 100)}..."`;

      } else {
        assistantExplanation = `Template generation issue: ${validationResult.reason}

Your SMS: "${smsText.substring(0, 100)}..."

Try:
- Making sure the SMS contains a clear OTP (4-8 digit number or code)
- Removing any unnecessary parts from the SMS
- Contacting support with the full SMS for manual template creation`;
      }

      return NextResponse.json(
        {
          error: `Failed to generate valid template after ${maxAttempts} attempts`,
          details: validationResult.reason,
          assistantExplanation,
          detectedOtp: detectedOtp,
          lastAttempt: template,
          supportContact: "If you continue having issues, please contact support with the exact SMS text."
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      template,
      extractedOtp: validationResult.otp,
      success: true,
      attempts: attempts
    });
  } catch (error) {
    console.error('Template generation error:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate template',
        details: error.message,
        assistantExplanation: 'This could be due to OpenAI API issues, invalid SMS format, or network problems. Please check your API configuration and try again.'
      },
      { status: 500 }
    );
  }
}
