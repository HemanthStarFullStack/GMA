// Backfill per-user product identity (UserProduct) from the shared catalogue.
//
// After the per-user product refactor, each account's display/forecast reads its
// own UserProduct (falling back to the shared Product). This seeds a UserProduct
// for every product a user already holds / logged / listed, copying their CURRENT
// shared values — so nothing visibly changes on rollout, and their items stop
// being mutable by other accounts' scans.
//
// Idempotent + insert-only (upsert with $setOnInsert). Safe to re-run.
//
// Run (auth via the container's own env, password never printed):
//   docker exec gma-mongodb sh -c 'mongosh --quiet \
//     --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" \
//     --authenticationDatabase admin "$MONGO_INITDB_DATABASE" --file /dev/stdin' < scripts/backfill-userproducts.js
(function () {
    const now = new Date();
    const byUser = {}; // userId -> { productId: true }
    function add(uid, pid) {
        if (!uid || !pid) return;
        (byUser[uid] || (byUser[uid] = {}))[pid] = true;
    }
    db.inventories.find({}, { userId: 1, productId: 1 }).forEach((d) => add(String(d.userId), d.productId));
    db.consumptionlogs.find({}, { userId: 1, productId: 1 }).forEach((d) => add(String(d.userId), d.productId));
    db.shoppinglists.find({ productId: { $exists: true, $ne: null } }, { userId: 1, productId: 1 })
        .forEach((d) => add(String(d.userId), d.productId));

    let created = 0, existing = 0, noShared = 0;
    Object.keys(byUser).forEach((uid) => {
        Object.keys(byUser[uid]).forEach((pid) => {
            const p = db.products.findOne({ barcode: pid });
            if (!p) { noShared++; return; } // ghost reference — nothing to seed from
            const doc = {
                userId: uid,
                productId: pid,
                name: p.name || ('Product ' + String(pid).slice(0, 8)),
                brand: p.brand || '',
                flavor: p.flavor || '',
                price: p.price || '',
                category: p.category || 'Other',
                imageUrl: (p.imageUrl !== undefined ? p.imageUrl : null),
                defaultUnit: p.defaultUnit || 'units',
                averageDuration: p.averageDuration || 14,
                createdAt: now,
                updatedAt: now,
            };
            if (p.perPersonDailyRate != null) doc.perPersonDailyRate = p.perPersonDailyRate;
            const res = db.userproducts.updateOne(
                { userId: uid, productId: pid },
                { $setOnInsert: doc },
                { upsert: true },
            );
            if (res.upsertedCount) created++; else existing++;
        });
    });
    print('backfill userproducts — created: ' + created + ', existing(skipped): ' + existing + ', no-shared-product: ' + noShared);
})();
