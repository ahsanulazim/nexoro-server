import { ObjectId } from "mongodb";
import client from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

const portfolioCollection = client.db("nexoro").collection("Portfolios");
await portfolioCollection.createIndex({ slug: 1 }, { unique: true });

// Create a new blog post
export const createPortfolio = async (req, res) => {
  const { title, content, author, service, description, visibility } = req.body;
  const slug = title.toString().toLowerCase().trim().replace(/[\s\W-]+/g, "-");
  const visible = visibility === "true";
  const serviceId = new ObjectId(service);
  const { filename, path } = req.file;
  const added = new Date();
  try {
    await portfolioCollection.insertOne({
      title,
      slug,
      content,
      author,
      serviceId,
      description,
      visibility: visible,
      image: path,
      public_id: filename,
      added,
    });
    res.status(200).json({ success: true });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .send({ success: false, message: "Portfolio already exists" });
    }
    res
      .status(500)
      .send({ success: false, message: "Failed to create portfolio" });
  }
};

export const getAllPortfolios = async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 10, 20);
  const skip = (page - 1) * limit;
  const categoryId = req.query.category;
  const filter = categoryId ? { serviceId: new ObjectId(categoryId) } : {};

  const totalPortfolios = await portfolioCollection.countDocuments();

  const portfolios = await portfolioCollection.aggregate([
    { $match: filter },
    {
      $lookup: {
        from: "Services",
        localField: "serviceId",
        foreignField: "_id",
        as: "service",
      },
    },
    {
      $unwind: "$service",
    },
    { $sort: { added: -1 } },
    { $skip: skip },
    { $limit: limit },
  ])
    .toArray();
  res.send({
    portfolios,
    totalPortfolios,
    totalPages: Math.ceil(totalPortfolios / limit),
    currentPage: page,
    hasNext: page * limit < totalPortfolios,
    hasPrev: page > 1,
    start: skip + 1,
    end: Math.min(skip + limit, totalPortfolios),
  });
};

export const getPortfolioServices = async (req, res) => {
  try {
    const allServices = await portfolioCollection.aggregate([
      {
        $lookup: {
          from: "Services",
          localField: "serviceId",
          foreignField: "_id",
          as: "service",
        },
      },
      { $unwind: "$service" },
      {
        $group: {
          _id: "$service._id",
          serviceTitle: { $first: "$service.title" },
        },
      },
      {
        $project: {
          _id: 1,
          serviceTitle: 1,
        },
      },
    ]).toArray();

    res.status(200).json({ allServices });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch services" });
  }
};

export const getPortfolio = async (req, res) => {
  const slug = req.params.slug;
  try {
    const portfolio = await portfolioCollection
      .aggregate([
        {
          $match: { slug },
        },
        {
          $lookup: {
            from: "Services",
            localField: "serviceId",
            foreignField: "_id",
            as: "service",
          },
        },
        {
          $unwind: "$service",
        },
        {
          $replaceRoot: {
            newRoot: {
              $mergeObjects: ["$$ROOT", { service: "$service.title" }],
            },
          },
        },
      ])
      .toArray();

    if (portfolio) {
      return res.status(200).json(portfolio[0]);
    } else {
      return res
        .status(404)
        .json({ success: false, message: "Portfolio not found" });
    }
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

export const deleteAPortfolio = async (req, res) => {
  const id = req.params.id;

  try {
    const result = await portfolioCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount > 0) {
      return res.send({
        success: true,
        message: "Portfolio deleted successfully",
      });
    } else {
      return res.send({
        success: false,
        message: "Portfolio not found in MongoDB",
      });
    }
  } catch (error) {
    return res
      .status(500)
      .send({ success: false, message: "Failed to delete Portfolio" });
  }
};

export const updatePortfolio = async (req, res) => {
  const id = req.params.id;
  const { title, content, author, category, description, visibility } =
    req.body;
  const visible = visibility === "true";
  const categoryId = new ObjectId(category);
  try {
    const existingPortfolio = await portfolioCollection.findOne({
      _id: new ObjectId(id),
    });
    if (!existingPortfolio) {
      return res.status(404).json({ message: "Portfolio not found" });
    }

    const updatedPortfolio = {
      title,
      content,
      author,
      description,
      categoryId,
      visible,
      updatedOn: new Date(),
    };

    if (req.file) {
      if (existingPortfolio.public_id) {
        cloudinary.uploader.destroy(existingPortfolio.public_id);
      }
      updatedPortfolio.image = req.file.path;
      updatedPortfolio.public_id = req.file.filename;
    } else {
      updatedPortfolio.image = existingPortfolio.image;
    }
    await portfolioCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedPortfolio }
    );
    res
      .status(200)
      .json({ success: true, message: "Portfolio Updated Successfully" });
  } catch (error) {
    console.error("Update Portfolio error:", error);
    res.status(500).json({ success: false, message: "Failed to Update Portfolio" });
  }
};
