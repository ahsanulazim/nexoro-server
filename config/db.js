import { MongoClient, ServerApiVersion } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const uri = `mongodb+srv://nexorosolution_db_user:${process.env.MONGODB_KEY}@nexoro.wwxkyqc.mongodb.net/?appName=nexoro`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function ensureInboxIndexes(db) {
  try {
    const msgCollection = db.collection("Messages");
    const convCollection = db.collection("Conversations");

    await Promise.all([
      msgCollection.createIndex({ roomId: 1, createdAt: -1 }),
      msgCollection.createIndex({ roomId: 1, isRead: 1, senderRole: 1 }),
      msgCollection.createIndex({ metaMessageId: 1 }, { sparse: true }),
      msgCollection.createIndex({ externalMetaId: 1 }, { sparse: true }),
      convCollection.createIndex({ roomId: 1 }, { unique: true }),
      convCollection.createIndex({ platform: 1, updatedAt: -1 }),
      convCollection.createIndex({ updatedAt: -1 }),
      convCollection.createIndex({ customerId: 1 }, { sparse: true }),
      convCollection.createIndex({ "customer.bsuid": 1 }, { sparse: true }),
      convCollection.createIndex({ "customer.phone": 1 }, { sparse: true }),
    ]);
  } catch (idxErr) {
    console.warn("Index initialization warning:", idxErr.message);
  }
}

async function run() {
  try {
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
    await ensureInboxIndexes(client.db("nexoro"));
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);
export default client;
