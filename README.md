# Namma Kadai - Backend + Razorpay

## Local la run panna
1. Node.js 22+ install pannunga.
2. `npm install`
3. `.env.example` a `.env` nu copy panni Razorpay keys podunga (illana online payment off, COD mattum work aagum).
4. `npm start` -> http://localhost:3000

## Public backend deploy (Render Blueprint)
1. Project-ai GitHub repository-la upload pannunga.
2. Render dashboard-la **New > Blueprint** select panni repository-ai connect pannunga. Root `render.yaml` paid Starter web service-um persistent disk-um configure pannum.
3. `ADMIN_PASSWORD`-ku kuraindhadhu 6 characters-oda unique password set pannunga. Razorpay use pannina `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`-ai Render environment settings-la mattum add pannunga; mudhalil test keys use pannunga.
4. Deploy mudindha pin Render kodukkum `https://...onrender.com` URL-ai note pannunga. API health check `/api/state`.
5. `public/app-config.js`-la `window.NAMMA_KADAI_API_URL`-க்கு backend URL set panni, `npm run mobile:sync` execute pannitu Android app-ai rebuild pannunga.

`SEED_DEMO=false` Blueprint-la set pannirukku; demo PIN accounts production-la create aagaadhu. Orders/stores `/var/data/data.json`-la persistent disk-la irukkum. Android app CORS-ku `https://localhost` origin server-la allow pannappattulladhu. Website browser-lendhu API call seiyanumna, Render environment-la comma-separated `APP_ALLOWED_ORIGINS` set pannunga.

## Razorpay
- Checkout la 3 option: Cash on delivery, **UPI (GPay, PhonePe, Paytm)**, Card / Net banking.
- UPI select pannina Razorpay screen la GPay, PhonePe, Paytm mattum kaattum. Phone la (HTTPS site la) andha app direct-a open aagum. Computer la QR illa UPI ID kekkum.
- Test mode la UPI ID `success@razorpay` kodutthaa payment success aagum, `failure@razorpay` kodutthaa fail aagum.
- Live mode la UPI enable aagi irukka Razorpay Dashboard la check pannunga.
- razorpay.com la account create panni KYC mudinga. Mudhalla **Test keys** la try pannunga.
- Secret key server la mattum irukku, browser ku povathu illa.

## Demo logins (real launch mun `server.js` la `seed()` remove pannunga)
- Stores: PIN `1234`
- Delivery partners: phone `9000000001`, `9000000002`, `9000000003`, PIN `1234`

## Admin panel (app owner) + PIN reset
- `.env` la `ADMIN_PASSWORD=...` set pannunga, server restart pannunga.
- Website la **Admin** tab -> password kodunga.
- Inga paarkalam: ellaa stores, delivery partners (online/offline), recent orders, total sales.
- Store owner / delivery partner PIN marandhuttaa: avanga row la 4-digit pudhu PIN type panni **Set PIN** click pannunga.
- **Delete** button: store / partner remove pannum (in-progress orders irundha block aagum).
- 5 thadava thappa admin password potta 5 nimisham lock aagum.

## Real launch checklist
1. `.env` la `ADMIN_PASSWORD` (6+ characters, example text illa) set pannunga. Illana Admin login work aagaadhu.
2. `SEED_DEMO=false` set pannunga (demo stores/partners illaama start aagum). Already demo data irundha Admin panel la **Remove demo stores and partners** click pannunga.
3. `.env` and `data.json` GitHub ku povaadha madiri `.gitignore` already irukku. Secret keys eppavum yaarukkum share pannaadheenga.

## Customer shopping
- Customer page la store name / area search pannalam; Supermarket, Mini store, Favorites filter use pannalam.
- Store heart button use panni favorites save pannina, adhe browser/device la local-a irukkum.
- Location allow pannina nearby stores distance padi sort aagum.

## Android app build + Play Store release
1. Install Node.js 22+ (Node 24 is supported), Android Studio with Android SDK 36, and JDK 21.
2. Deploy the backend on a public HTTPS host with persistent storage. Set `SEED_DEMO=false`, a strong `ADMIN_PASSWORD`, Razorpay **live** keys on the server, and `APP_ALLOWED_ORIGINS` for any public website origin. Never put Razorpay secrets in the app.
3. Put the backend HTTPS origin (without `/api`) in `public/app-config.js` as `window.NAMMA_KADAI_API_URL = "https://your-api-host.example";`.
4. Run `npm install`, then `npm run mobile:sync`. Open Android Studio with `npm run mobile:open`; test location permissions, COD, Razorpay payments, orders, and all account roles on a physical Android device.
5. In Android Studio choose **Build > Generate Signed Bundle / APK > Android App Bundle**. Keep the upload key safe and private. Upload the signed `.aab` through a Google Play Console developer account and complete its required testing, store listing, data-safety, and review steps.

The Android package name is `com.nammakadai.app`. An HTTPS backend URL and Google Play Console account are required before the app can be released. Replace the business/contact placeholders in `public/privacy-policy.html` before publishing its URL in Play Console; the app uses delivery addresses and optional customer / delivery-partner location.

## Star rating
- Order "delivered" aanadhum, customer "Your orders" la **Rate your order** varum: store-ku 1-5 stars, delivery partner-ku 1-5 stars, optional comment.
- Oru order-ku oru thadava mattum rate pannalam.
- Store cards-la, store page-la average rating theriyum. Store owner-ku customer comment theriyum. Delivery partner ku thanoda rating theriyum. Admin panel la ellaa ratings-um.
- Ippo order ID theriyuravanga rate pannalam (customer login illa). Real launch ku customer login add pannunga.

## Delivery partner
- Website la "Delivery partner" tab -> Register (peru, 10-digit phone, 4-digit PIN) -> Login.
- "Share my live location" click pannina, partner location 15 second ku oru thadava server ku pogum.
- Store owner "Assign nearest delivery partner" click pannina, last 2 nimisham la location share panna partners la nearest ku order pogum.
- Order "picked up" aana, customer "Your orders" la "Track delivery partner on map" link paarkalam.
- 5 thadava thappa PIN potta 5 nimisham lock aagum.

## Innum thevai (production ku mun)
- Phone OTP (SMS provider venum, ex: MSG91/Twilio). Ippo phone + PIN thaan.
- Live map (ippo Google Maps link thaan, in-page map illa).
- Razorpay webhook (customer payment mudichu browser close panna kooda order paid nu mark aaga).
- SQLite/Postgres database, HTTPS (Render automatic-a tharum).
- Customer order status ID-a vechu mattum fetch aagum; real launch ku customer login add pannunga.
