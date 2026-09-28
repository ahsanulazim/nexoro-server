import client from "../config/db.js";
import admin from "../admin/firebase.config.js";

const orderCollection = client.db("nexoro").collection("Orders");
const teamCollection = client.db("nexoro").collection("Team");

export const getAllProjects = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 10);
    const skip = (page - 1) * limit;
    const tab = (req.query.tab || req.query.filterTab || "all").toLowerCase();
    const search = (req.query.search || req.query.searchTerm || "").trim();

    let currentUserEmail = (req.query.userEmail || "").toLowerCase().trim();
    let currentUserId = (req.query.userId || "").trim();
    let currentUserName = (req.query.userName || "").toLowerCase().trim();

    // Optionally extract from auth token if not passed in query
    if (!currentUserEmail && req.headers.authorization) {
      try {
        const token = req.headers.authorization.split(" ")[1];
        if (token) {
          const decoded = await admin.auth().verifyIdToken(token);
          if (decoded?.email) currentUserEmail = decoded.email.toLowerCase().trim();
          if (!currentUserId && decoded?.uid) currentUserId = decoded.uid.trim();
          if (!currentUserName && decoded?.name) currentUserName = decoded.name.toLowerCase().trim();
        }
      } catch (e) {
        // Fall back gracefully
      }
    }

    // Look up team member ID if user email/name is present
    let memberIdStr = "";
    if (currentUserEmail || currentUserName) {
      const orMemberQuery = [];
      if (currentUserEmail) {
        orMemberQuery.push({ email: { $regex: new RegExp(`^${currentUserEmail}$`, "i") } });
      }
      if (currentUserName) {
        orMemberQuery.push({ memberName: { $regex: new RegExp(`^${currentUserName}$`, "i") } });
      }
      if (orMemberQuery.length > 0) {
        const memberDoc = await teamCollection.findOne({ $or: orMemberQuery });
        if (memberDoc) {
          memberIdStr = memberDoc._id.toString();
        }
      }
    }

    const assignedMatchConditions = [];
    if (currentUserEmail) {
      assignedMatchConditions.push({
        $eq: [{ $toLower: { $ifNull: ["$assignedMemberEmail", ""] } }, currentUserEmail],
      });
    }
    if (currentUserId) {
      assignedMatchConditions.push({
        $eq: [{ $toString: { $ifNull: ["$assignedToId", ""] } }, currentUserId],
      });
    }
    if (memberIdStr) {
      assignedMatchConditions.push({
        $eq: [{ $toString: { $ifNull: ["$assignedToId", ""] } }, memberIdStr],
      });
    }
    if (currentUserName) {
      assignedMatchConditions.push({
        $eq: [{ $toLower: { $ifNull: ["$assignedTo", ""] } }, currentUserName],
      });
    }

    const isAssignedExpr =
      assignedMatchConditions.length > 0
        ? { $or: assignedMatchConditions }
        : false;

    // Filter conditions for active tab & search
    const filterConditions = [];

    if (tab === "active") {
      filterConditions.push({ isActive: true });
    } else if (tab === "completed") {
      filterConditions.push({ isCompleted: true });
    } else if (tab === "my") {
      filterConditions.push({ isAssignedToMe: true });
    }

    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const searchRegex = new RegExp(escapedSearch, "i");
      filterConditions.push({
        $or: [
          { serviceName: { $regex: searchRegex } },
          { planName: { $regex: searchRegex } },
          { client: { $regex: searchRegex } },
          { assignedTo: { $regex: searchRegex } },
          { orderId: { $regex: searchRegex } },
        ],
      });
    }

    const matchStage =
      filterConditions.length > 0 ? { $match: { $and: filterConditions } } : null;

    const pipeline = [
      // Filter out orders where assignedTo is null, empty, or missing
      {
        $match: {
          assignedTo: { $ne: null, $exists: true, $nin: ["", null] },
        },
      },
      { $sort: { createdAt: -1 } },
      // Lookup service from Services collection by matching slug with order.service
      {
        $lookup: {
          from: "Services",
          localField: "service",
          foreignField: "slug",
          as: "serviceDoc",
        },
      },
      // Lookup team member from Team collection by matching _id with order.assignedTo
      {
        $lookup: {
          from: "Team",
          let: { assignedToId: "$assignedTo" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $ne: ["$$assignedToId", null] },
                    { $ne: ["$$assignedToId", ""] },
                    {
                      $eq: [
                        "$_id",
                        {
                          $convert: {
                            input: "$$assignedToId",
                            to: "objectId",
                            onError: null,
                            onNull: null,
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
          as: "teamMember",
        },
      },
      // Lookup registered user from Users collection by matching _id with order.assignedTo
      {
        $lookup: {
          from: "Users",
          let: { assignedToId: "$assignedTo" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $ne: ["$$assignedToId", null] },
                    { $ne: ["$$assignedToId", ""] },
                    {
                      $eq: [
                        "$_id",
                        {
                          $convert: {
                            input: "$$assignedToId",
                            to: "objectId",
                            onError: null,
                            onNull: null,
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
          as: "userMember",
        },
      },
      // Lookup client name from Clients collection (if clientId exists)
      {
        $lookup: {
          from: "Clients",
          let: { clientIdVal: "$clientId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $ne: ["$$clientIdVal", null] },
                    { $ne: ["$$clientIdVal", ""] },
                    {
                      $eq: [
                        "$_id",
                        {
                          $convert: {
                            input: "$$clientIdVal",
                            to: "objectId",
                            onError: null,
                            onNull: null,
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
            {
              $project: {
                _id: 0,
                name: 1,
              },
            },
          ],
          as: "clientDoc",
        },
      },
      // Extract matched service, member, user, and client
      {
        $addFields: {
          matchedService: { $arrayElemAt: ["$serviceDoc", 0] },
          matchedMember: { $arrayElemAt: ["$teamMember", 0] },
          matchedUser: { $arrayElemAt: ["$userMember", 0] },
          matchedClient: { $arrayElemAt: ["$clientDoc", 0] },
        },
      },
      // Extract matched plan from matchedService.plans matching planId
      {
        $addFields: {
          matchedPlan: {
            $arrayElemAt: [
              {
                $filter: {
                  input: { $ifNull: ["$matchedService.plans", []] },
                  as: "plan",
                  cond: {
                    $eq: [
                      { $toString: "$$plan.id" },
                      { $toString: "$planId" },
                    ],
                  },
                },
              },
              0,
            ],
          },
        },
      },
      // Project the final structure
      {
        $project: {
          _id: 1,
          orderId: 1,
          client: { $ifNull: ["$matchedClient.name", null] },
          planName: {
            $cond: {
              if: { $eq: ["$service", "custom"] },
              then: "Custom Plan",
              else: { $ifNull: ["$matchedPlan.planName", null] },
            },
          },
          serviceName: {
            $cond: {
              if: { $eq: ["$service", "custom"] },
              then: { $ifNull: ["$serviceName", "Custom Service"] },
              else: { $ifNull: ["$matchedService.title", "$service"] },
            },
          },
          servicePrice: {
            $cond: {
              if: { $eq: ["$service", "custom"] },
              then: {
                $convert: {
                  input: { $ifNull: ["$servicePrice", "$price"] },
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
              else: {
                $convert: {
                  input: {
                    $ifNull: [
                      "$matchedPlan.price",
                      { $ifNull: ["$price", 0] },
                    ],
                  },
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
          },
          price: 1,
          assignedTo: {
            $ifNull: [
              "$matchedUser.name",
              { $ifNull: ["$matchedMember.memberName", null] },
            ],
          },
          assignedToId: "$assignedTo",
          assignedMemberEmail: {
            $ifNull: [
              "$matchedUser.email",
              { $ifNull: ["$matchedMember.email", null] },
            ],
          },
          assignedMemberRole: {
            $ifNull: [
              "$matchedUser.role",
              { $ifNull: ["$matchedMember.role", null] },
            ],
          },
          status: 1,
          deadline: { $ifNull: ["$deadline", null] },
          amount: {
            $convert: {
              input: "$amount",
              to: "double",
              onError: 0,
              onNull: 0,
            },
          },
          discount: {
            $convert: {
              input: "$discount",
              to: "double",
              onError: 0,
              onNull: 0,
            },
          },
          payment: 1,
          paymentMethod: 1,
          tasks: 1,
          costs: { $ifNull: ["$costs", []] },
          totalCost: { $ifNull: ["$totalCost", 0] },
          createdBy: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      // Add completion, active and assigned flags
      {
        $addFields: {
          isCompleted: {
            $let: {
              vars: {
                statusLower: { $toLower: { $ifNull: ["$status", ""] } },
                tasksList: { $ifNull: ["$tasks", []] },
              },
              in: {
                $cond: {
                  if: { $eq: ["$$statusLower", "cancelled"] },
                  then: false,
                  else: {
                    $cond: {
                      if: { $eq: ["$$statusLower", "completed"] },
                      then: true,
                      else: {
                        $cond: {
                          if: {
                            $and: [
                              { $isArray: "$$tasksList" },
                              { $gt: [{ $size: "$$tasksList" }, 0] },
                              {
                                $eq: [
                                  {
                                    $size: {
                                      $filter: {
                                        input: "$$tasksList",
                                        as: "t",
                                        cond: { $eq: ["$$t.isCompleted", true] },
                                      },
                                    },
                                  },
                                  { $size: "$$tasksList" },
                                ],
                              },
                            ],
                          },
                          then: true,
                          else: false,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      {
        $addFields: {
          isActive: {
            $cond: {
              if: { $eq: [{ $toLower: { $ifNull: ["$status", ""] } }, "cancelled"] },
              then: false,
              else: { $not: "$isCompleted" },
            },
          },
          isAssignedToMe: isAssignedExpr,
        },
      },
      // Facet for tab counts, totalFiltered count, and paginated data
      {
        $facet: {
          overallCounts: [
            {
              $group: {
                _id: null,
                totalAll: { $sum: 1 },
                totalActive: {
                  $sum: { $cond: ["$isActive", 1, 0] },
                },
                totalCompleted: {
                  $sum: { $cond: ["$isCompleted", 1, 0] },
                },
                totalMy: {
                  $sum: { $cond: ["$isAssignedToMe", 1, 0] },
                },
              },
            },
          ],
          totalFiltered: [
            ...(matchStage ? [matchStage] : []),
            { $count: "count" },
          ],
          data: [
            ...(matchStage ? [matchStage] : []),
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: limit },
          ],
        },
      },
    ];

    const [result] = await orderCollection.aggregate(pipeline).toArray();

    const projects = result?.data || [];
    const totalProjects = result?.totalFiltered?.[0]?.count || 0;
    const countsData = result?.overallCounts?.[0] || {};
    const totalPages = Math.max(1, Math.ceil(totalProjects / limit));

    return res.status(200).json({
      success: true,
      projects,
      pagination: {
        currentPage: page,
        totalPages,
        totalProjects,
        limit,
        hasNext: page < totalPages,
        hasPrev: page > 1,
        start: totalProjects === 0 ? 0 : skip + 1,
        end: Math.min(skip + limit, totalProjects),
      },
      counts: {
        all: countsData.totalAll || 0,
        active: countsData.totalActive || 0,
        completed: countsData.totalCompleted || 0,
        my: countsData.totalMy || 0,
      },
    });
  } catch (error) {
    console.error("Get all projects error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};
