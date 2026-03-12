import crypto from "crypto";

//generate hash

const generateHash = (data, key) => {
    return crypto.createHmac("sha256", Buffer.from(key, "utf8")).update(data).digest("base64");
};

//Get Token

