// WhatsApp Cloud API helpers.
//
// Env vars (set in Vercel):
//   REACT_APP_WHATSAPP_API_URL    e.g. https://graph.facebook.com/v21.0
//   REACT_APP_WHATSAPP_PHONE_ID   your WhatsApp phone number ID
//   REACT_APP_WHATSAPP_TOKEN      a permanent access token
//
// IMPORTANT — the 24-hour rule:
//   Meta only allows free-form TEXT messages within 24 hours of the
//   recipient last messaging your number. Outside that window (e.g.
//   a fee reminder you send first), you MUST use an approved TEMPLATE
//   message. That's why the Meta dashboard "hello_world" template
//   works but a plain text test may not.

function config() {
  return {
    apiUrl: process.env.REACT_APP_WHATSAPP_API_URL,
    phoneId: process.env.REACT_APP_WHATSAPP_PHONE_ID,
    token: process.env.REACT_APP_WHATSAPP_TOKEN,
  };
}

async function post(body) {
  const { apiUrl, phoneId, token } = config();
  if (!apiUrl || !phoneId || !token) {
    console.warn("WhatsApp not configured — message not sent.");
    return { ok: false, skipped: true, error: "WhatsApp not configured" };
  }
  try {
    const res = await fetch(`${apiUrl}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      // Surface Meta's actual error so failures aren't silent.
      const msg = data?.error?.message || `HTTP ${res.status}`;
      console.error("WhatsApp API error:", data?.error || data);
      return { ok: false, error: msg, raw: data };
    }
    return { ok: true, raw: data };
  } catch (err) {
    console.error("WhatsApp network error:", err);
    return { ok: false, error: err?.message || "Network error" };
  }
}

const clean = (phone) => String(phone || "").replace(/[^0-9]/g, "");

// Free-form text. Works ONLY inside the 24-hour window.
export async function sendWhatsAppMessage(phone, message) {
  return post({ to: clean(phone), type: "text", text: { body: message } });
}

// Template message. Works for first-contact / outside 24 hours.
// `components` lets you fill {{1}}, {{2}} ... placeholders.
export async function sendWhatsAppTemplate(phone, templateName, languageCode = "en_US", components = []) {
  return post({
    to: clean(phone),
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length ? { components } : {}),
    },
  });
}

// Convenience: send the built-in "hello_world" template that every
// new WhatsApp app has by default — ideal for a connection test that
// works even outside the 24-hour window.
export async function sendWhatsAppHelloTest(phone) {
  return sendWhatsAppTemplate(phone, "hello_world", "en_US");
}
