const PROMPTPAY_AID = "A000000677010111";

function field(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

function crc16Ccitt(value: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(value)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function promptPayPayload(phoneNumber: string): string {
  const phone = phoneNumber.replace(/\D/g, "");
  if (!/^0\d{9}$/.test(phone)) {
    throw new Error("PromptPay phone number must contain 10 digits and start with 0");
  }

  const proxy = `0066${phone.slice(1)}`;
  const merchantAccount = field("00", PROMPTPAY_AID) + field("01", proxy);
  const body = field("00", "01")
    + field("01", "11")
    + field("29", merchantAccount)
    + field("58", "TH")
    + field("53", "764")
    + "6304";

  return body + crc16Ccitt(body);
}
