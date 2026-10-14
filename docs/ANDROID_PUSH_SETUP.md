# Android push notifications: one-time setup (Firebase + Expo)

**Status (2026-10-14): not done.** Until it is, no Android phone can receive any push from Weaver
(announcements, boli, lunch and survey notices, homework): the app cannot get a push token, so
Settings › Push notifications shows "Something went wrong while trying to register this phone for
notifications". Nothing is wrong on the server side. The portal, database and background service
already queue and send pushes through Expo; Expo needs a Firebase key to hand them to Android.

## Why this was found

2026-10-13: a class announcement published in the portal showed in the member app (3L › Learn › Class
announcements) but never appeared in the phone's notification tray. The app's Android config
(`app.json`) has no `android.googleServicesFile`, there is no `google-services.json`, and no Firebase
or FCM setup is recorded anywhere in either repo. The exact device error was not read (the app logs it
only to the phone's console); the symptom matches Expo's "Default FirebaseApp is not initialized" failure.
To confirm without a new build: connect the phone with USB debugging and run `adb logcat | findstr connect`,
or ship the small update that shows the real reason in Settings (see "Optional").

## Part 1: what the owner does (about 10 minutes; your Google and Expo accounts)

1. **Firebase project.** Go to https://console.firebase.google.com › *Add project* (any name, for
   example "Weaver"; Google Analytics is not needed).
2. **Android app.** In the project: *Add app* › Android. Package name **`org.connectplatform.member`**
   (exactly; it is `expo.android.package` in connect-mobile `app.json`). Skip the optional steps.
   **Download `google-services.json`.**
3. **FCM key for Expo.** Firebase › ⚙ Project settings › *Service accounts* › **Generate new private
   key**. This downloads a JSON file. It is a secret: do not commit it, do not paste it in chat or an
   email. It only goes to Expo (next step).
4. **Upload the key to Expo.** https://expo.dev › account `malav.sanghavi` › project `connect-mobile` ›
   *Credentials* › Android › the application identifier `org.connectplatform.member` › *FCM V1 service
   account key* › add/upload the file from step 3. (Command-line alternative:
   `npx eas-cli@24.8.0 credentials --platform android`, choose the `preview` profile, Google Service
   Account › Manage your Google Service Account Key for Push Notifications (FCM V1) › Upload.)
5. **Tell Claude where `google-services.json` is saved** (for example the Downloads folder). Never send
   the private key from step 3.

## Part 2: what Claude does, once Part 1 is done

1. In connect-mobile, in a branch and PR: add `google-services.json` at the repo root (it is client
   configuration, not a secret) and set `expo.android.googleServicesFile` to `"./google-services.json"` in
   `app.json`.
2. **Bump `runtimeVersion` from 3 to 4** (this is a native change, so a new APK is needed and old APKs must
   not be sent JavaScript built for it), bump the version to 1.20.0 in `app.json` and `package.json`, and
   add a CHANGELOG section.
3. After the checks pass and the PR is merged, build the APK from main:
   `npx --yes eas-cli@24.8.0 build --platform android --profile preview --non-interactive`
   (about 15 to 20 minutes on EAS; it prints the install link). Then publish the OTA for the new runtime if
   there is JavaScript newer than the build.
4. The owner installs the new APK (the old app can stay until then; it keeps working but cannot do push).

## Part 3: test it

1. Open the new app and sign in. *Settings › Push notifications* should say "Master switch for all alerts ·
   on for this phone". Allow notifications when Android asks.
2. **Mind quiet hours.** The default is 9 PM to 7 AM (Houston time): a push due then is held until 7 AM.
   To test in the evening, move the quiet-hours start later in portal › Settings › Notifications first,
   then restore it.
3. Publish a **new** announcement in Pathshala › Announcements to a class (or Whole Pathshala) that your
   household has a student placed or active in. Republishing an old one does not resend (each person is
   told once per announcement).
4. If nothing arrives, open portal › Settings › Notifications › *Recent messages* and find the push: its
   status is `queued` (held for quiet hours), `sent` (Expo accepted it: check Android's notification
   permission for Weaver), or `failed` / `suppressed` with the reason on the row.

## Notes

- **iOS** is a separate setup (an Apple Developer account and APNs credentials, handled by EAS when an
  iOS build is made). Not started; the member app is tested on an Android preview APK today.
- **Existing APKs** (runtime 3) stay as they are; OTAs for runtime 3 do not reach the new APK and the
  reverse. See `docs/DEPLOY.md` and the connect-mobile release routine.
- **Optional, small OTA:** make the app's push status name the real cause (a plain sentence for the
  missing-Firebase case) instead of the generic fallback, so the next person is not guessing.
- Pushes that were queued while the phone had no token were never delivered and are not resent. Only
  messages queued after the phone registers can arrive.
