import { ObjectId } from "mongodb";
import client from "../config/db.js";
import cloudinary from "../config/cloudinary.js";
import { broadcastDashboardStats } from "../utils/dashboardHelper.js";

const clientCollection = client.db("nexoro").collection("Clients");
await clientCollection.createIndex({ email: 1 }, { unique: true });

//create new client
export const createClient = async (req, res) => {
  const { name, company, role, email, phone, country } = req.body;
  const { filename, path } = req.file || {};
  const joined = new Date();

  try {
    await clientCollection.insertOne({
      name,
      company,
      role,
      email,
      phone,
      country,
      slider: false,
      logo: path,
      public_id: filename,
      joined,
    });

    // Real-time broadcast for dashboard stats
    broadcastDashboardStats().catch((err) =>
      console.error("Dashboard stats broadcast error:", err)
    );

    res.status(200).send({ success: true });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .send({ success: false, message: "Client already exists" });
    }
    console.error("Create client error:", error);
    res
      .status(500)
      .send({ success: false, message: "Failed to create client" });
  }
};

// Get all clients (supports server-side pagination, search, filter, and sorting)
export const getAllClients = async (req, res) => {
  try {
    const { page, limit, search, country, sort, all } = req.query;

    // Backward-compatible fallback: return all clients array if no pagination params or explicitly asked
    if (all === "true" || (!page && !limit && !search && !country && !sort)) {
      const clients = await clientCollection
        .find()
        .sort({ joined: -1, _id: -1 })
        .toArray();
      return res.status(200).send(clients);
    }

    const currentPage = Math.max(parseInt(page, 10) || 1, 1);
    const pageSize = Math.max(parseInt(limit, 10) || 9, 1);
    const skip = (currentPage - 1) * pageSize;

    // Filter query
    const query = {};

    // Filter by country
    if (country && country !== "all") {
      query.country = { $regex: `^${country.trim()}$`, $options: "i" };
    }

    // Debounced search query across multiple fields
    if (search && search.trim()) {
      const regex = { $regex: search.trim(), $options: "i" };
      query.$or = [
        { name: regex },
        { company: regex },
        { email: regex },
        { role: regex },
        { country: regex },
        { phone: regex },
      ];
    }

    // Sorting definition
    let sortObj = { joined: -1, _id: -1 };
    if (sort === "oldest") {
      sortObj = { joined: 1, _id: 1 };
    } else if (sort === "name_asc") {
      sortObj = { name: 1 };
    } else if (sort === "name_desc") {
      sortObj = { name: -1 };
    } else if (sort === "company_asc") {
      sortObj = { company: 1 };
    }

    // Total filtered records
    const totalMatching = await clientCollection.countDocuments(query);
    const totalPages = Math.ceil(totalMatching / pageSize) || 1;

    // Fetch paginated records from MongoDB
    const clients = await clientCollection
      .find(query)
      .sort(sortObj)
      .skip(skip)
      .limit(pageSize)
      .toArray();

    // High-level aggregate statistics
    const totalAllCount = await clientCollection.countDocuments();

    // Unique countries for filter list (using aggregate for MongoDB API Version 1 strict compliance)
    const countryAgg = await clientCollection
      .aggregate([
        {
          $match: {
            country: { $exists: true, $type: "string", $nin: ["", null] },
          },
        },
        { $group: { _id: "$country" } },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    const validCountries = countryAgg
      .map((c) => (c._id || "").trim())
      .filter((c) => c.length > 0);

    // Unique companies count (using aggregate for MongoDB API Version 1 strict compliance)
    const companyAgg = await clientCollection
      .aggregate([
        {
          $match: {
            company: { $exists: true, $type: "string", $nin: ["", null] },
          },
        },
        { $group: { _id: "$company" } },
        { $count: "total" },
      ])
      .toArray();

    const totalCompanies = companyAgg[0]?.total || 0;

    // Recently added (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentClients = await clientCollection.countDocuments({
      $or: [
        { joined: { $gte: thirtyDaysAgo } },
        { createdAt: { $gte: thirtyDaysAgo } },
      ],
    });

    res.status(200).json({
      success: true,
      clients,
      pagination: {
        total: totalMatching,
        totalPages,
        currentPage,
        pageSize,
      },
      stats: {
        totalClients: totalAllCount,
        totalCompanies,
        totalCountries: validCountries.length,
        recentClients,
      },
      countries: validCountries,
    });
  } catch (error) {
    console.error("Get clients error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch clients",
      error: error.message,
    });
  }
};

// delete client
export const deleteClient = async (req, res) => {
  const email = req.params.email;
  try {
    const result = await clientCollection.deleteOne({ email });
    if (result.deletedCount > 0) {
      // Real-time broadcast for dashboard stats
      broadcastDashboardStats().catch((err) =>
        console.error("Dashboard stats broadcast error:", err)
      );

      return res.status(200).json({
        success: true,
        message: "Client deleted successfully",
      });
    } else {
      return res.status(404).json({
        success: false,
        message: "Client not found in database",
      });
    }
  } catch (error) {
    console.error("Delete error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to delete Client" });
  }
};

// update client
export const updateClient = async (req, res) => {
  try {
    const id = req.params.id;
    const { name, company, role, email, phone, country, slider } = req.body;
    const existingClient = await clientCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!existingClient) {
      return res.status(404).json({ message: "Client not found" });
    }
    const updatedClient = {
      name,
      company,
      role,
      email,
      phone,
      country,
      slider,
      updatedAt: new Date(),
    };

    if (req.file) {
      if (existingClient.public_id) {
        cloudinary.uploader.destroy(existingClient.public_id);
      }
      updatedClient.logo = req.file.path;
      updatedClient.public_id = req.file.filename;
    } else {
      updatedClient.logo = existingClient.logo;
    }

    await clientCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedClient },
    );
    res
      .status(200)
      .json({ success: true, message: "Client updated successfully" });
  } catch (error) {
    console.error("Update client error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to update client" });
  }
};
