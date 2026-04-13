import { NextResponse } from 'next/server';
import OpenAI from 'openai';

// Copy functions from f.mjs
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

      // First {otp} gets named capture group, subsequent ones get non-capturing group
      // This prevents "Duplicate capture group name" regex errors
      let isFirstOtp = true;
      pattern = pattern.replace(/\\\{otp\\\}/gi, () => {
        if (isFirstOtp) {
          isFirstOtp = false;
          return "(?<otp>[A-Za-z0-9\\-]{3,12})";
        }
        return "(?:[A-Za-z0-9\\-]{3,12})";
      });

      pattern = pattern.replace(/\\\{date\\\}/gi, ".*?");
      pattern = pattern.replace(/\\\{datetime\\\}/gi, ".*?");
      pattern = pattern.replace(/\\\{time\\\}/gi, ".*?");
      pattern = pattern.replace(/\\\{random\\\}/gi, "[A-Za-z0-9]{3,15}");
      pattern = pattern.replace(/\\\{.*?\\\}/gi, ".*?");

      pattern = pattern
        .replace(/\\s+/g, "\\s+")
        .replace(/\\:/g, "[:：]?")
        .replace(/\\\./g, ".*?");

      return new RegExp(pattern, "i");
    })
    .filter(Boolean);
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
    const maxAttempts = 5;

    do {
      attempts++;

      const prompt = `
You are an expert SMS template generator. Convert the following SMS message into a template that works with our regex system.

CRITICAL RULES (follow exactly):
- Use exactly ONE {otp} placeholder for the OTP code
- Keep the template SIMPLE and FOCUSED - only include essential parts to locate the OTP
- Do NOT try to match the entire SMS perfectly - focus on finding the OTP reliably

Placeholders (use only when needed):
- {otp} - For the OTP/delivery/verification code (digits or alphanumeric, 3-12 characters)
- {any} - For anything else that varies (amounts, dates, URLs, random strings, etc.)
- {random} - For purely alphanumeric random tokens (no special chars like /+.)

TEMPLATE SIMPLIFICATION STRATEGY:
1. Find the OTP/delivery code in the SMS
2. Include 3-5 words BEFORE the OTP
3. Include 3-5 words AFTER the OTP
4. Replace everything else with {any}

Examples showing simplification:

Example 1 (OTP SMS):
SMS: "<#> 1770 is your OTP to login into Airtel Thanks app. Valid for 100 secs. Do not share with anyone. If this was not you click i.airtel.in/Contact N9BWuqauU1y"
Template: "<#> {otp} is your OTP to login into {any}. Valid for {time}. Do not share with anyone."

Example 2 (Delivery code SMS):
SMS: "Your delivery code is 123456. Show this to the delivery agent at the time of delivery."
Template: "Your delivery code is {otp}. Show this to {any}."

Example 3 (OTP appears multiple times):
SMS: "Dear customer, 5672 is your OTP. Expires in 3 min. Do not share. Reference #5672"
Template: "Dear customer, {otp} is your OTP. Expires in {time}. Do not share."

Example 4 (Amount included):
SMS: "Order delivered. Pay Rs 450.0 using code 789012 before expiry."
Template: "Order delivered. Pay {any} using code {otp} before {any}."

For YOUR SMS, apply the simplification strategy:
1. Find the OTP/delivery/verification code
2. Keep minimal context around it (3-5 words before/after)
3. Replace all other varying parts with {any}

SMS to convert:
"${smsText}"

Return ONLY the template string, nothing else.
`;


      const completion = await openai.chat.completions.create({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: "You are an expert SMS template generator. Return ONLY the template string, no explanations. Ensure the template contains exactly one {otp} placeholder and can extract the OTP from the SMS. Follow the user's instructions precisely, especially about using only one {otp} and handling repeated OTPs with {any}."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 1000,
        temperature: 1,
      });

      template = completion.choices[0]?.message?.content?.trim();

      console.log(`[Template Gen] Attempt ${attempts}: Generated template = "${template}"`);

      if (!template) {
        console.error('OpenAI API completion response:', JSON.stringify(completion, null, 2));
        throw new Error(`Failed to generate template. API response: ${completion.choices?.length || 0} choices returned`);
      }

      // Clean the template - remove any surrounding quotes or unwanted characters
      template = template.replace(/^"+|"+$/g, '').trim();

      // Validate the generated template
      validationResult = validateTemplate(template, smsText);
      console.log(`[Template Gen] Attempt ${attempts}: Validation result =`, validationResult);

    } while (!validationResult.valid && attempts < maxAttempts);

    if (!validationResult.valid) {
      let assistantExplanation = '';

      if (validationResult.reason.includes('multiple')) {
        assistantExplanation = `The AI generated a template with multiple {otp} placeholders, which is not allowed. This usually happens when the SMS contains the OTP multiple times.

Suggested solutions:
1. Try using only the first occurrence of the OTP in your SMS
2. Remove any repeated OTP references from the SMS text
3. If the OTP appears at the end (like #5672), consider omitting that part
4. Example: For "Dear customer, 5672 is your OTP... #5672", use "Dear customer, 5672 is your OTP..."`;

      } else if (validationResult.reason.includes('No {otp}')) {
        assistantExplanation = `The generated template doesn't contain any {otp} placeholder. This means the AI didn't identify an OTP in your SMS.

Suggested solutions:
1. Ensure your SMS contains a clear OTP (numbers or alphanumeric code)
2. Make sure the OTP is not obscured by special characters or formatting
3. Try rephrasing the SMS to highlight the OTP more clearly`;

      } else if (validationResult.reason.includes('Could not extract')) {
        assistantExplanation = `The template was generated but couldn't extract the OTP from your SMS. This might be due to complex formatting or unusual OTP patterns.

Suggested solutions:
1. Simplify the SMS text by removing unnecessary details
2. Ensure the OTP is in a standard format (4-6 digits or alphanumeric)
3. Avoid having the OTP multiple times in the message
4. Contact support with the exact SMS for manual template creation`;

      } else {
        assistantExplanation = `The template generation failed due to: ${validationResult.reason}

General advice:
- Keep SMS messages clear and concise
- Avoid multiple OTP references
- Use standard OTP formats (e.g., 4-6 digits)
- If issues persist, contact support with the exact SMS text for assistance`;
      }

      return NextResponse.json(
        {
          error: `Failed to generate valid template after ${maxAttempts} attempts`,
          details: validationResult.reason,
          assistantExplanation,
          supportContact: "For immediate assistance, please contact support with the exact SMS text."
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      template,
      extractedOtp: validationResult.otp,
      success: true
    });
  } catch (error) {
    console.error('Template generation error:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate template',
        details: error.message,
        assistantExplanation: 'This could be due to OpenAI API issues, invalid SMS format, or internal server errors. Check your API key and try again.'
      },
      { status: 500 }
    );
  }
}
