// Sends a WhatsApp message via the Meta (WhatsApp Cloud) API.
// Requires three env vars (set in Vercel):
//   REACT_APP_WHATSAPP_API_URL   e.g. https://graph.facebook.com/v21.0
//   REACT_APP_WHATSAPP_PHONE_ID  your WhatsApp phone number ID
//   REACT_APP_WHATSAPP_TOKEN     a permanent access token
//
// If these aren't configured, sending is skipped gracefully so the
// rest of the app keeps working.
export async function sendWhatsAppMessage(phone, message) {
  const apiUrl = process.env.REACT_APP_WHATSAPP_API_URL;
  const phoneId = process.env.REACT_APP_WHATSAPP_PHONE_ID;
  const token = process.env.REACT_APP_WHATSAPP_TOKEN;

  if (!apiUrl || !phoneId || !token) {
    console.warn("WhatsApp not configured — message not sent.");
    return { skipped: true };
  }

  const cleanPhone = phone.replace(/[^0-9]/g, "");
  try {
    const res = await fetch(`${apiUrl}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: cleanPhone,
        type: "text",
        text: { body: message },
      }),
    });
    const data = await res.json();
    return data;
  } catch (err) {
    console.error("WhatsApp error:", err);
    return { error: true };
  }
}
