export async function sendWhatsAppMessage(phone, message) {
  const cleanPhone = phone.replace(/[^0-9]/g, "");
  try {
    const res = await fetch(`${process.env.REACT_APP_WHATSAPP_API_URL}/${process.env.REACT_APP_WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.REACT_APP_WHATSAPP_TOKEN}`,
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
  }
}