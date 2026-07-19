import admin from "../admin/firebase.config.js";
import client from "../config/db.js";

const userCollection = client.db("nexoro").collection("Users");

export const verifyAdmin = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized access" });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const user = await userCollection.findOne({ email: decodedToken.email });

    if (user?.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admins only" });
    }

    next();
  } catch (error) {
    return res
      .status(403)
      .json({ success: false, message: "Invalid or expired token" });
  }

  // const userEmail = req.user?.email;
  // const user = await userCollection.findOne({ email: userEmail });

  // if (user?.role !== "admin") {
  //   return res.status(403).json({ success: false, message: "Admins only" });
  // }

  // next();
};
