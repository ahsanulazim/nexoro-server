import client from "../config/db.js";

const orderCollection = client.db("nexoro").collection("Orders");

export const getAllProjects = async (req, res) => {
  try {
    const projects = await orderCollection
      .aggregate([
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
        // Extract matched service, member, and client
        {
          $addFields: {
            matchedService: { $arrayElemAt: ["$serviceDoc", 0] },
            matchedMember: { $arrayElemAt: ["$teamMember", 0] },
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
              $ifNull: ["$matchedMember.memberName", null],
            },
            tasks: 1,
            createdBy: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      ])
      .toArray();

    res.status(200).json({ success: true, projects });
  } catch (error) {
    console.error("Get all projects error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};
