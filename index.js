const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const verifyJWT = async (req, res, next) => {
  const authorization = await req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorizedgg access" });
  }
  const token = authorization.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_SECRET_TOKEN, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .send({ error: true, message: "unauthorizeddd access" });
    }
    req.decoded = decoded;
    next();
  });
};

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.USER_DB}:${process.env.USER_PASS}@cluster0.pr3rbd0.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const userCollection = client.db("bistroDb").collection("users");
    const menuCollection = client.db("bistroDb").collection("menus");
    const reviewCollection = client.db("bistroDb").collection("reviews");
    const cartCollection = client.db("bistroDb").collection("carts");
    const paymentCollection = client.db("bistroDb").collection("payments");

    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_SECRET_TOKEN, {
        expiresIn: "1h",
      });
      res.send({ token: token });
    });

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      if (user?.role !== "admin") {
        return res
          .status(403)
          .send({ error: true, message: "forbidden request" });
      }
      next();
    };

    //users related apis
    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
    
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const newUser = req.body;
      const query = { email: newUser?.email };
      const findUser = await userCollection.findOne(query);
      if (findUser) {
        return res.send({ message: "User Already Exist" });
      }
      const result = await userCollection.insertOne(newUser);
      res.send(result);
    });

    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;

      const filter = { _id: new ObjectId(id) };
      const updateUserRole = {
        $set: {
          role: "admin",
        },
      };
      const result = await userCollection.updateOne(filter, updateUserRole);
      res.send(result);
    });

    app.delete("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(filter);
      res.send(result);
    });

    //  security layer: verifyJWT
    // email same
    // check admin

    app.get("/users/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      if (req.decoded.email !== email) {
        res.send({ admin: false });
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const result = { admin: user?.role === "admin" };
      res.send(result);
    });

    //menu collection
    app.get("/menu", async (req, res) => {
      const result = await menuCollection.find({}).toArray();
      res.send(result);
    });

    app.post("/menu", verifyJWT, verifyAdmin, async (req, res) => {
      const newItem = req.body;
      console.log(newItem);
      const result = await menuCollection.insertOne(newItem);
      res.send(result);
    });

    app.delete("/menu/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    });

    //review collection
    app.get("/reviews", async (req, res) => {
      const result = await reviewCollection.find({}).toArray();
      res.send(result);
    });

    // cart collection
    app.post("/carts", async (req, res) => {
      const item = req.body;
      const result = await cartCollection.insertOne(item);
      res.send(result);
    });

    //cart items
    app.get("/carts", verifyJWT, async (req, res) => {
      const email = req.query?.email;
      if (!email) {
        res.send([]);
      }
      const decodedEmail = req.decoded?.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ error: 1, message: "request forbidden" });
      }
      const query = { email: email };

      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    //delete cart item
    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    // online stripe payment api
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "inr",
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    //payment collection
    app.post("/payments", verifyJWT, async (req, res) => {
      const payment = req.body;
      const insertResult = await paymentCollection.insertOne(payment);
      const cartId = payment?.cartItems.map((id) => new ObjectId(id));
      const query = { _id: { $in: cartId } };
      const deleteResult = await cartCollection.deleteMany(query);
      res.send({ result: insertResult, deleteResult });
    });

    app.get("/admin-stats", async (req, res) => {
      const customers = await userCollection.estimatedDocumentCount();
      const products = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();
      const payments = await paymentCollection.find({}).toArray();
      const revenue = payments.reduce((sum, payment) => sum + payment.price, 0);

      /* 
      
      await paymentCollection.aggregate([
        {
          $group:{
            _id: null,
            total:{$sum: '$price'}
          }
        }
      ]).toArray()

      */

      res.send({ customers, products, orders, revenue });
    });

    app.get("/order-stats", async (req, res) => {
      /* 
      bangle system___________________________________________________
      const paymentData = await paymentCollection.find().toArray();
      const menuItemsData = await menuCollection.find().toArray();

      const result = menuItemsData.reduce((acc, menuItem) => {
        const category = menuItem.category;
        const count = paymentData.reduce((total, payment) => {
          const menuItems = payment.menuItems.map((itemId) =>
            itemId.toString()
          );
          if (menuItems.includes(menuItem._id.toString())) {
            return total + 1;
          }
          return total;
        }, 0);

        const totalPrice = paymentData.reduce((total, payment) => {
          const menuItems = payment.menuItems.map((itemId) =>
            itemId.toString()
          );
          if (menuItems.includes(menuItem._id.toString())) {
            const menuItemData = menuItemsData.find(
              (item) => item._id.toString() === menuItem._id.toString()
            );
            return total + parseFloat(menuItemData.price);
          }
          return total;
        }, 0);

        const existingCategory = acc.find(
          (entry) => entry.category === category
        );
        if (existingCategory) {
          existingCategory.totalPrice += totalPrice;
        } else {
          acc.push({ category, count, totalPrice });
        }

        return acc;
      }, []);
      _____________________________________________________________________________
      */

      const pipeline = [
        {
          $addFields: {
            menuItemsIds: {
              $map: {
                input: "$menuItems",
                as: "id",
                in: { $toObjectId: "$$id" },
              },
            },
          },
        },
        {
          $lookup: {
            from: "menus",
            localField: "menuItemsIds",
            foreignField: "_id",
            as: "menuItemsData",
          },
        },
        {
          $unwind: "$menuItemsData",
        },
        {
          $group: {
            _id: "$menuItemsData.category",
            count: { $sum: 1 },
            totalPrice: { $sum: "$menuItemsData.price" },
          },
        },

        {
          $project: {
            category: "$_id",
            count: 1,
            totalPrice: 1,
            _id: 0,
          },
        },
      ];

      const result = await paymentCollection.aggregate(pipeline).toArray();

      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    // Send a ping to confirm a successful connection
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("hello world");
});

app.listen(port, () => {
  console.log(`boss is running on port ${port}`);
});
