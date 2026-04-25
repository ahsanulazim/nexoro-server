import { ObjectId } from "mongodb";
import client from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

const portfolioCollection = client.db("nexoro").collection("Portfolios");
await portfolioCollection.createIndex({ slug: 1 }, { unique: true });

export const createPortfolio = async (req, res) => {
  const {
    title,
    content,
    author,
    service,
    subService,
    visibility,
    carousel,
    description,
  } = req.body;

  const slug = title
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[\s\W-]+/g, "-");

  const visible = visibility === "true";
  const homepage = carousel === "true";

  // Validate service ID
  if (!ObjectId.isValid(service)) {
    return res.status(400).json({ error: "Invalid service ID" });
  }
  const serviceId = new ObjectId(service);

  // Handle optional subService
  let subServiceId;
  if (subService && ObjectId.isValid(subService)) {
    subServiceId = new ObjectId(subService);
  }

  const { filename, path } = req.file;
  const added = new Date();

  try {
    const portfolioDoc = {
      title,
      slug,
      content,
      author,
      carousel: homepage,
      serviceId,
      description,
      visibility: visible,
      image: path,
      public_id: filename,
      added,
    };

    // Only add subServiceId if it exists
    if (subServiceId) {
      portfolioDoc.subServiceId = subServiceId;
    }

    await portfolioCollection.insertOne(portfolioDoc);

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

  const portfolios = await portfolioCollection
    .aggregate([
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
        $lookup: {
          from: "SubServices",
          localField: "subServiceId",
          foreignField: "_id",
          as: "subService",
        },
      },
      {
        $unwind: "$service",
      },
      {
        $unwind: {
          path: "$subService",
          preserveNullAndEmptyArrays: true,
        },
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
    const allServices = await portfolioCollection
      .aggregate([
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
      ])
      .toArray();

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
          $lookup: {
            from: "SubServices",
            localField: "subServiceId",
            foreignField: "_id",
            as: "subService",
          },
        },
        {
          $unwind: "$service",
        },
        {
          $unwind: {
            path: "$subService",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $replaceRoot: {
            newRoot: {
              $mergeObjects: [
                "$$ROOT",
                {
                  service: "$service.title",
                  subService: "$subService.subService",
                },
              ],
            },
          },
        },
      ])
      .toArray();

    if (portfolio && portfolio.length > 0) {
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
    const result = await portfolioCollection.deleteOne({
      _id: new ObjectId(id),
    });
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

  const {
    title,
    content,
    author,
    carousel,
    subService,
    description,
    visibility,
  } = req.body;

  const slug = title
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[\s\W-]+/g, "-");

  const visible = visibility === "true";
  const homepage = carousel === "true";

  // Handle optional subService
  let subServiceId;
  if (subService && ObjectId.isValid(subService)) {
    subServiceId = new ObjectId(subService);
  }

  try {
    const existingPortfolio = await portfolioCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!existingPortfolio) {
      return res.status(404).json({ message: "Portfolio not found" });
    }

    const updatedPortfolio = {
      title,
      slug,
      content,
      author,
      carousel: homepage,
      description,
      visibility: visible,
      updatedOn: new Date(),
    };

    // Only add subServiceId if provided
    if (subServiceId) {
      updatedPortfolio.subServiceId = subServiceId;
    }

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
      { $set: updatedPortfolio },
    );

    res
      .status(200)
      .json({ success: true, message: "Portfolio Updated Successfully" });
  } catch (error) {
    console.error("Update Portfolio error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to Update Portfolio" });
  }
};
