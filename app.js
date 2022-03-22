const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const dbPath = path.join(__dirname, "twitterClone.db");
const app = express();

app.use(express.json());

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(-1);
  }
};
initializeDBAndServer();

//middleware
const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

// API 1 user Register
app.post("/register/", async (request, response) => {
  const { username, name, password, gender } = request.body;
  const hashedPassword = await bcrypt.hash(request.body.password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    let passLength = password.length;
    if (passLength >= 6) {
      const createUserQuery = `
                    INSERT INTO 
                        user (username, name, password, gender) 
                    VALUES 
                        (
                        '${username}', 
                        '${name}',
                        '${hashedPassword}', 
                        '${gender}'
                        )`;
      await db.run(createUserQuery);
      response.status(200);
      response.send(`User created successfully`);
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//User Login API
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);

  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//API 3 Path: /user/tweets/feed/  Method: GET
// Returns the latest tweets of people whom the user follows. Return 4 tweets at a time
const convertUserTweetObjectNames = (object) => {
  return {
    username: object.username,
    tweet: object.tweet,
    dateTime: object.date_time,
  };
};
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userIdData = `SELECT user_id FROM user WHERE username = '${username}';`;
  const objUserId = await db.get(userIdData);
  const selectLatestTweetQuery = `SELECT username, tweet, date_time FROM
                                     user LEFT JOIN tweet
                                     ON user.user_id = tweet.user_id
                                     WHERE user.user_id IN 
                                     (SELECT following_user_id FROM follower 
                                      WHERE 
                                      follower_user_id = ${objUserId.user_id})
                                      order by date_time DESC
                                      LIMIT 4;`;
  const followerData = await db.all(selectLatestTweetQuery);
  response.send(followerData.map((each) => convertUserTweetObjectNames(each)));
});

//API 4 Path: /user/following/ Method: GET

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userIdData = `SELECT user_id FROM user WHERE username = '${username}';`;
  const objUserId = await db.get(userIdData);
  const selectLatestTweetQuery = `SELECT name FROM
                                     user
                                     WHERE user_id IN 
                                     (SELECT following_user_id FROM follower 
                                      WHERE 
                                      follower_user_id = ${objUserId.user_id});`;
  const followingNames = await db.all(selectLatestTweetQuery);
  response.send(followingNames);
});
//API 5 Path: /user/followers/ Method: GET

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userIdData = `SELECT user_id FROM user WHERE username = '${username}';`;
  const objUserId = await db.get(userIdData);
  const selectLatestTweetQuery = `SELECT name FROM
                                     user
                                     WHERE user_id IN 
                                     (SELECT follower_user_id FROM follower 
                                      WHERE 
                                      following_user_id = ${objUserId.user_id});`;
  const followerNames = await db.all(selectLatestTweetQuery);
  response.send(followerNames);
});

//API 6 Path: /tweets/:tweetId/ Method: GET
const convertStatObjectNames = (tweet, like, reply) => {
  return {
    tweet: tweet.tweet,
    likes: like.likes,
    replies: reply.replies,
    dateTime: tweet.date_time,
  };
};

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;
  const { username } = request;
  const userIdData = `SELECT user_id FROM user WHERE username = '${username}';`;
  const objUserId = await db.get(userIdData);
  const selectUserQuery = `SELECT user_id FROM
                                     user
                                     WHERE user_id IN 
                                     (SELECT following_user_id FROM follower 
                                      WHERE 
                                      follower_user_id = ${objUserId.user_id});`;
  const tweetUserId = `SELECT user_id FROM tweet WHERE tweet_id = ${tweetId};`;
  const userID = await db.get(tweetUserId);
  const dbUser = await db.all(selectUserQuery);
  console.log(dbUser);
  console.log(userID);
  // checks
  const check = (element) => element.user_id === userID.user_id;
  console.log(dbUser.some(check));

  //The GET request to the path '/tweets/:tweetId/' with valid JWT token
  // should return the `Invalid Request` text if the user requests a tweet other
  // than the users he is following
  if (dbUser.some(check) === false) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const getTweetLikesQuery = `SELECT COUNT(*) AS likes FROM
                                   like where tweet_id = ${tweetId};`;

    const getRepliesQuery = `SELECT COUNT(*) AS replies FROM
                                 reply where tweet_id = ${tweetId};`;

    const getTweetAndDateQuery = `SELECT tweet,date_time FROM 
                                    tweet WHERE tweet_id = ${tweetId};`;
    const statLikes = await db.get(getTweetLikesQuery);
    const statReplies = await db.get(getRepliesQuery);
    const statTweetAndDate = await db.get(getTweetAndDateQuery);
    response.send(
      convertStatObjectNames(statTweetAndDate, statLikes, statReplies)
    );
  }
});

//API 7 Path: /tweets/:tweetId/likes/ Method: GET

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const userIdData = `SELECT user_id FROM user WHERE username = '${username}';`;
    const objUserId = await db.get(userIdData);
    const selectUserQuery = `SELECT user_id FROM
                                     user
                                     WHERE user_id IN 
                                     (SELECT following_user_id FROM follower 
                                      WHERE 
                                      follower_user_id = ${objUserId.user_id});`;
    const tweetUserId = `SELECT user_id FROM tweet WHERE tweet_id = ${tweetId};`;
    const userID = await db.get(tweetUserId);
    const dbUser = await db.all(selectUserQuery);
    //console.log(dbUser);
    //console.log(userID);
    // checks
    const check = (element) => element.user_id === userID.user_id;
    console.log(dbUser.some(check));

    if (dbUser.some(check) === false) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getLikedNamesQuery = `SELECT username FROM user 
                                        NATURAL JOIN like
                                        WHERE 
                                        tweet_id = ${tweetId};`;
      const userNames = await db.all(getLikedNamesQuery);
      let newArray = [];
      console.log(userNames);
      for (let each of userNames) {
        newArray.push(each.username);
      }
      response.send({
        likes: newArray,
      });
    }
  }
);
// API 8 Path: /tweets/:tweetId/replies/ Method: GET

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const userIdData = `SELECT user_id FROM user WHERE username = '${username}';`;
    const objUserId = await db.get(userIdData);
    const selectUserQuery = `SELECT user_id FROM
                                     user
                                     WHERE user_id IN 
                                     (SELECT following_user_id FROM follower 
                                      WHERE 
                                      follower_user_id = ${objUserId.user_id});`;
    const tweetUserId = `SELECT user_id FROM tweet WHERE tweet_id = ${tweetId};`;
    const userID = await db.get(tweetUserId);
    const dbUser = await db.all(selectUserQuery);
    console.log(dbUser);
    console.log(userID);
    // checks
    const check = (element) => element.user_id === userID.user_id;
    console.log(dbUser.some(check));

    if (dbUser.some(check) === false) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getTweetRepliesQuery = `SELECT name,reply 
                                        FROM user 
                                        NATURAL JOIN reply  
                                        WHERE tweet_id = ${tweetId};`;

      const nameReply = await db.all(getTweetRepliesQuery);
      console.log(nameReply);
      const newArray = [];
      for (let each of nameReply) {
        newArray.push(each);
      }
      response.send({ replies: newArray });
    }
  }
);

//API 9 Path: /user/tweets/ Method: GET

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userIdData = `SELECT user_id FROM user WHERE username = '${username}';`;
  const objUserId = await db.get(userIdData);
  const tweetIdQuery = `SELECT tweet_id FROM
                         tweet WHERE
                         user_id = ${objUserId.user_id};`;
  const tweetId = await db.all(tweetIdQuery);
  const getTweetLikesQuery = `SELECT COUNT(*) AS likes FROM
                                   like where tweet_id IN (SELECT tweet_id FROM
                         tweet WHERE
                         user_id = ${objUserId.user_id})
                         GROUP BY tweet_id;`;

  const getRepliesQuery = `SELECT COUNT(*) AS replies FROM
                                 reply where tweet_id IN (SELECT tweet_id FROM
                         tweet WHERE
                         user_id = ${objUserId.user_id})
                         GROUP BY tweet_id;`;

  const getTweetAndDateQuery = `SELECT tweet,date_time FROM 
                                    tweet WHERE user_id = ${objUserId.user_id};`;

  const statLikes = await db.all(getTweetLikesQuery);
  const statReplies = await db.all(getRepliesQuery);
  const statTweetAndDate = await db.all(getTweetAndDateQuery);
  let len = statTweetAndDate.length;

  let i = 0;
  let neUserTweetsArray = [];
  while (i < len) {
    neUserTweetsArray.push(
      convertStatObjectNames(statTweetAndDate[i], statLikes[i], statReplies[i])
    );
    i = i + 1;
  }
  console.log(neUserTweetsArray);
  response.send(neUserTweetsArray);
});

//API 10 Path: /user/tweets/ Method: POST
//{"tweet": "The Mornings..."}

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweet } = request.body;
  const userIdData = `SELECT user_id FROM user WHERE username = '${username}';`;
  const objUserId = await db.get(userIdData);
  const postNewTweet = `INSERT INTO tweet (tweet, user_id) VALUES
                            ('${tweet}',${objUserId.user_id}); `;
  await db.run(postNewTweet);
  response.status(200);
  response.send("Created a Tweet");
});

//API 11 Path: /tweets/:tweetId/ Method: DELETE
//If the user requests to delete a tweet of other users
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const userIdData = `SELECT user_id FROM user WHERE username = '${username}';`;
    const objUserId = await db.get(userIdData);
    const tweetUserIdQuery = `SELECT user_id FROM
                         tweet WHERE
                         tweet_id = ${tweetId};`;
    const userID = await db.get(tweetUserIdQuery);
    if (objUserId.user_id === userID.user_id) {
      const removeTweetQuery = `DELETE FROM tweet WHERE tweet_id = ${tweetId};`;
      await db.run(removeTweetQuery);
      response.status(200);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
