import admin from "firebase-admin";
import dotenv from "dotenv";
dotenv.config();

const serviceAccount = {
  type: "service_account",
  project_id: "nexoro-58c7b",
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key:
    "-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDbtU6VLQ4OUHSj\nJwLeOBbTuUjLe7YbEHeUgswgedGsFqtoZfrgcfTTeUzkGPzq1m1Lb3qy0eX86Ijf\nSyB+m6t1uy5zDR4rYs+jYVHqd/eIYhZyRVBnxna43m0NoPKCwls/iYg4x42GqAOP\nOWtn4MOxm80G5o6kBjQ8n3I/KppVs7dW97YgMERUk6+S4dEHLq4QmKUcRK7UYgiv\nb+NZ6lp5BqrSg+XUD0/QRXvAcElEMLdmxRGz8QW3BUcl+JXHpuTsn5Dm/P+ouYUr\noqLSD1Pop6N6GwJqOXLdGkKveMKEsCUW+cxZDnMWeKx6QqBupXoSkFLTJRPLoHcK\nR+H1MkF7AgMBAAECggEAPUhNKv7uNL/sSLXQ7vrmIxhDXb6cBOCK+jmhhk10VnPc\nS7pmR8SBbZsf/1+Y7EfzJF9r8gTqCakyxFXIMohpQuV7B0xZZfChygiTOLtNqBTz\n/dunmcqZwucHtA14l1Bu80IBZRUEPNMQaxqxAsCG1TuH7KzSjJ3OZDp1O3k+oziB\nFY8EI3uc8x13ipFMdxI2o1p33vg771GhsZJfkmk/sOwyXaHZ1kJz1Rrbe3gvgKzC\nWb3grtfmwlX8vMPiwfKEzbXnjTOkUSaEbU/NDkqd42JxYhvCkWMwPr0C2hJxWbtP\nWHfxmEbm+UhbeZ2daAGeouN0SRlrul9hm18OEeM1AQKBgQD8MdblUjyi+JIzMTTl\nj+6fsPYh6uQbFNBbNACjCgAILtNblaI7/P63vqSDT/I4UoPFdJ0SwFfEPoIqaI0Y\nwdpl+dGni8tffTkGvlsIZxXw/gmii4+gHD4ENVM+8G+nKXYE2UAbFor5fQxh4oo4\nq6TvYGoAzrV2DbQY/DK9lB77CwKBgQDfBfsl6oYqghBZbRdd2S/0hw4+uCdmC1a7\nqm6szp2MSyd/8osRW+DWeoMMhGIguptQMDhuXDsuDq9EXJznCcIYGNu67iOZmtM1\nqZt7+JdMFt3L/NAbpoVvv63lgnZntK2BxUw0j8+OqMf7PoZzjwgRL9LdqUWJEwbA\nfsfRWRpZUQKBgHkhnywqYcGNTvuTqOqSRXUiVDZaUhHH34PO6Hdm+Dj19MLKjk/t\n5pJu2SnRHnB7AZu3tTIqfH1f4Llp2kuH4NSWN2MYPCizRs68Y5EXomxMOGiATA4F\nQqxWyJM0fQx3V55gku/v1fSbYXUqkGVD3Ea1snSM1I/NaTGPAPgZyv+dAoGAQ3Kf\nnbvrj3d+Uk03v94rLpyZpkYzRB0xwdetWP2zj/Y6n+tOO5W5zaOHdoWi15sX1Yx/\nxICINUmjn90SZp0A4iDCcyoKAi5cqeH9b+SifRR9R2/R0ErwF/e0M7Dc9kgiIRj2\nDv9fGhnZQRaLuu8K1YfNEdRbfzUN2bF95MY5vcECgYABSA9JBdR+n48+hghKRvJ/\n5wYzwRflhYSG79o0gKft+LOrClOCqQqkoNiI4hWzp17HyY/H+jmej1E6HvHgf4i3\n3rNw/8J8Z0Cuz496SyrY9XIYlXFgIAlSi7RMDPt8O2K7d2YBaJRCFp4vP7bO+F+A\nXWZghSvqmDUyEBlo3HMquw==\n-----END PRIVATE KEY-----\n",
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url:
    "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40nexoro-58c7b.iam.gserviceaccount.com",
  universe_domain: "googleapis.com",
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export default admin;
