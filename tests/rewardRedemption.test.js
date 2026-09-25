const {
  test,
  before,
  beforeEach,
  after,
} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const Database = require("better-sqlite3");
const express = require("express");

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");

const migrations = path.join(
  __dirname,
  "../src/db/migrations"
);

for (const file of fs
  .readdirSync(migrations)
  .filter((entry) => entry.endsWith(".sql"))
  .sort()) {
  db.exec(
    fs.readFileSync(
      path.join(migrations, file),
      "utf8"
    )
  );
}

const dbModule = require.resolve(
  "../src/database/db"
);

require.cache[dbModule] = {
  id: dbModule,
  filename: dbModule,
  loaded: true,
  exports: db,
};

const app = express();
app.use(express.json());

app.use(
  "/tasks",
  require("../src/routes/taskRoutes")
);

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  baseUrl =
    `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  db.exec(`
    DELETE FROM family_reward_goals;
    DELETE FROM family_star_transactions;
    DELETE FROM rewards;
    DELETE FROM family_members;
  `);
});

after(async () => {
  await new Promise((resolve) =>
    server.close(resolve)
  );

  db.close();
});

function createMember(
  name = "Test Member"
) {
  const result = db
    .prepare(`
      INSERT INTO family_members (
        name,
        colour,
        is_active
      )
      VALUES (?, '#3B82F6', 1)
    `)
    .run(name);

  return Number(result.lastInsertRowid);
}

function createReward({
  title = "Test Reward",
  starCost = 10,
} = {}) {
  const result = db
    .prepare(`
      INSERT INTO rewards (
        title,
        star_cost,
        is_active
      )
      VALUES (?, ?, 1)
    `)
    .run(title, starCost);

  return Number(result.lastInsertRowid);
}

function addStars(
  familyMemberId,
  stars
) {
  db.prepare(`
    INSERT INTO family_star_transactions (
      family_member_id,
      task_id,
      occurrence_date,
      stars,
      transaction_type,
      description
    )
    VALUES (
      ?, NULL, '', ?,
      'adjustment',
      'Test star balance'
    )
  `).run(
    familyMemberId,
    stars
  );
}

function getBalance(
  familyMemberId
) {
  const row = db
    .prepare(`
      SELECT
        COALESCE(
          SUM(stars),
          0
        ) AS stars
      FROM family_star_transactions
      WHERE family_member_id = ?
    `)
    .get(familyMemberId);

  return Number(row?.stars) || 0;
}

function getRedemptions(
  familyMemberId
) {
  return db
    .prepare(`
      SELECT *
      FROM family_star_transactions
      WHERE family_member_id = ?
        AND transaction_type =
          'redemption'
      ORDER BY id ASC
    `)
    .all(familyMemberId);
}

async function redeem(
  rewardId,
  familyMemberId
) {
  const response = await fetch(
    `${baseUrl}/tasks/rewards/${rewardId}/redeem`,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        familyMemberId,
      }),
    }
  );

  return {
    status: response.status,
    data: await response.json(),
  };
}

test(
  "reward redemption deducts the correct stars",
  async () => {
    const memberId =
      createMember();

    const rewardId =
      createReward({
        starCost: 10,
      });

    addStars(memberId, 15);

    const result =
      await redeem(
        rewardId,
        memberId
      );

    assert.equal(
      result.status,
      200
    );

    assert.equal(
      result.data.success,
      true
    );

    assert.equal(
      result.data.redemption
        .starsSpent,
      10
    );

    assert.equal(
      result.data.redemption
        .remainingStars,
      5
    );

    assert.equal(
      getBalance(memberId),
      5
    );

    const redemptions =
      getRedemptions(memberId);

    assert.equal(
      redemptions.length,
      1
    );

    assert.equal(
      redemptions[0].stars,
      -10
    );
  }
);

test(
  "insufficient stars reject redemption without changing balance",
  async () => {
    const memberId =
      createMember();

    const rewardId =
      createReward({
        starCost: 10,
      });

    addStars(memberId, 5);

    const result =
      await redeem(
        rewardId,
        memberId
      );

    assert.equal(
      result.status,
      400
    );

    assert.equal(
      result.data.success,
      false
    );

    assert.equal(
      result.data.balance,
      5
    );

    assert.equal(
      result.data.required,
      10
    );

    assert.equal(
      getBalance(memberId),
      5
    );

    assert.equal(
      getRedemptions(memberId)
        .length,
      0
    );
  }
);

test(
  "two competing redemptions cannot spend the same stars twice",
  async () => {
    const memberId =
      createMember();

    const rewardId =
      createReward({
        starCost: 10,
      });

    addStars(memberId, 10);

    const results =
      await Promise.all([
        redeem(
          rewardId,
          memberId
        ),
        redeem(
          rewardId,
          memberId
        ),
      ]);

    const successes =
      results.filter(
        (result) =>
          result.status === 200
      );

    const rejected =
      results.filter(
        (result) =>
          result.status === 400
      );

    assert.equal(
      successes.length,
      1
    );

    assert.equal(
      rejected.length,
      1
    );

    assert.equal(
      getRedemptions(memberId)
        .length,
      1
    );

    assert.equal(
      getBalance(memberId),
      0
    );
  }
);