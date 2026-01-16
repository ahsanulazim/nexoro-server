import { ObjectId } from "mongodb";
import client from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

const blogCollection = client.db("nexoro").collection("Blogs");
await blogCollection.createIndex({ slug: 1 }, { unique: true });

// Create a new blog post
export const createBlog = async (req, res) => {
  const { title, content, author, category, description, visibility } =
    req.body;
  const slug = title.toString().toLowerCase().trim().replace(/[\s\W-]+/g, "-");
  const visible = visibility === "true";
  const categoryId = new ObjectId(category);
  const { filename, path } = req.file;
  const added = new Date();
  try {
    await blogCollection.insertOne({
      title,
      slug,
      content,
      author,
      categoryId,
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
        .send({ success: false, message: "Blog post already exists" });
    }
    res
      .status(500)
      .send({ success: false, message: "Failed to create blog post" });
  }
};

export const getAllBlogs = async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 10, 20);
  const skip = (page - 1) * limit;

  const totalBlogs = await blogCollection.countDocuments();

  const blogs = await blogCollection
    .aggregate([
      {
        $lookup: {
          from: "Categories",
          localField: "categoryId",
          foreignField: "_id",
          as: "category",
        },
      },
      {
        $unwind: "$category",
      },
      { $sort: { added: -1 } },
      { $skip: skip },
      { $limit: limit },
    ])
    .toArray();
  res.send({
    blogs,
    totalBlogs,
    totalPages: Math.ceil(totalBlogs / limit),
    currentPage: page,
    hasNext: page * limit < totalBlogs,
    hasPrev: page > 1,
    start: skip + 1,
    end: Math.min(skip + limit, totalBlogs),
  });
};

export const getBlog = async (req, res) => {
  const slug = req.params.slug;
  try {
    const blog = await blogCollection
      .aggregate([
        {
          $match: { slug },
        },
        {
          $lookup: {
            from: "Categories",
            localField: "categoryId",
            foreignField: "_id",
            as: "category",
          },
        },
        {
          $unwind: "$category",
        },
        {
          $replaceRoot: {
            newRoot: {
              $mergeObjects: ["$$ROOT", { category: "$category.category" }],
            },
          },
        },
      ])
      .toArray();

    if (blog) {
      return res.status(200).json(blog[0]);
    } else {
      return res
        .status(404)
        .json({ success: false, message: "Blog not found" });
    }
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

export const deleteABlog = async (req, res) => {
  const id = req.params.id;

  try {
    const result = await blogCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount > 0) {
      return res.send({
        success: true,
        message: "Blog deleted successfully",
      });
    } else {
      return res.send({
        success: false,
        message: "Blog not found in MongoDB",
      });
    }
  } catch (error) {
    return res
      .status(500)
      .send({ success: false, message: "Failed to delete Blog" });
  }
};

export const updateBlog = async (req, res) => {
  const id = req.params.id;
  const { title, slug, content, author, category, description, visibility } =
    req.body;
  const visible = visibility === "true";
  const categoryId = new ObjectId(category);
  try {
    const existingBlog = await blogCollection.findOne({
      _id: new ObjectId(id),
    });
    if (!existingBlog) {
      return res.status(404).json({ message: "Blog not found" });
    }

    const updatedBlog = {
      title,
      slug,
      content,
      author,
      description,
      categoryId,
      visible,
      updatedOn: new Date(),
    };

    if (req.file) {
      if (existingBlog.public_id) {
        cloudinary.uploader.destroy(existingBlog.public_id);
      }
      updatedBlog.image = req.file.path;
      updatedBlog.public_id = req.file.filename;
    } else {
      updatedBlog.image = existingBlog.image;
    }
    await blogCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedBlog }
    );
    res
      .status(200)
      .json({ success: true, message: "Blog Updated Successfully" });
  } catch (error) {
    console.error("Update Blog error:", error);
    res.status(500).json({ success: false, message: "Failed to Update Blog" });
  }
};
