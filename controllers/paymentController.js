import crypto from "crypto";

//generate hash

const generateHash = (data, key) => {
  return crypto
    .createHmac("sha512", Buffer.from(key, "utf8"))
    .update(data)
    .digest("base64");
};

//Get Token

export const getToken = async (req, res) => {
  try {
    const xHash = generateHash(
      process.env.EPS_USERNAME,
      process.env.EPS_HASH_KEY,
    );
    const response = await fetch(`${process.env.EPS_URL}/Auth/GetToken`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hash": xHash,
      },
      body: JSON.stringify({
        userName: process.env.EPS_USERNAME,
        password: process.env.EPS_PASSWORD,
      }),
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Token Generation Failed" });
  }
};

//Initialize Payment
export const handlePayment = async (req, res) => {
  try {
    const { token, slug, plan, customer } = req.body;
    const merchantTransactionId = Date.now().toString();
    const xHash = generateHash(
      process.env.EPS_USERNAME,
      process.env.EPS_HASH_KEY,
    );

    const response = await fetch(
      `${process.env.EPS_URL}/EPSEngine/InitializeEPS`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hash": xHash,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          merchantId: process.env.EPS_MERCHANT_ID,
          storeId: process.env.EPS_STORE_ID,
          CustomerOrderId: "Order" + Date.now(),
          merchantTransactionId,
          transactionTypeId: 1,
          totalAmount: plan.price,
          successUrl: "https://yourdomain.com/success",
          failUrl: "https://yourdomain.com/fail",
          cancelUrl: "https://yourdomain.com/cancel",
          customerName: customer.fullname,
          customerEmail: customer.email,
          customerAddress: customer.address,
          customerCity: customer.city,
          customerState: "Dhaka",
          customerPostcode: customer.postcode,
          customerCountry: "BD",
          customerPhone: customer.phone,
          productName: slug,
        }),
      },
    );

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Payment Initialization Failed" });
  }
};
