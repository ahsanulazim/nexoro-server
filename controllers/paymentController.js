import crypto from "crypto";
import { getNextOrderId } from "./orderController.js";
import client from "../config/db.js";

const serviceCollection = client.db("nexoro").collection("Services");

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
    const orderId = await getNextOrderId();
    const merchantTransactionId = Date.now().toString();
    const service = await serviceCollection.findOne({ slug });
    const planDetails = service.plans.find((p) => p.id.toString() === plan);

    const xHash = generateHash(merchantTransactionId, process.env.EPS_HASH_KEY);

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
          CustomerOrderId: orderId,
          merchantTransactionId,
          transactionTypeId: 1,
          totalAmount: planDetails.price,
          successUrl: `${process.env.FRONTEND_URL}/payment-successful`,
          failUrl: `${process.env.FRONTEND_URL}/payment-failed`,
          cancelUrl: `${process.env.FRONTEND_URL}/payment-cancelled`,
          customerName: customer.fullname,
          customerEmail: customer.email,
          customerAddress: customer.address,
          customerCity: customer.city,
          customerState: customer.state,
          customerPostcode: customer.zip,
          customerCountry: customer.country.value,
          customerPhone: customer.phone,
          productName: service.title + " - " + planDetails.planName,
        }),
      },
    );

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Payment Initialization Failed" });
  }
};
