# Reference bar for blind critics

Fetch date for every source: 2026-10-18. UNVERIFIED means not fetched or not found in a primary source.
Tags: **[P]** vendor page. **[S]** press or transcript. **[SNIP]** search snippet only.

## Source key

- D1 https://blog.research.google/2018/05/duplex-ai-system-for-natural-conversation.html [P]
- D2 https://theoutline.com/post/4492/google-io-2018-world-dispatch [S] (podcast transcript)
- D3 https://9to5google.com/2018/05/18/google-duplex-demo-assistant-recording/ [S]
- D4 https://9to5google.com/2018/06/27/google-duplex-testing-details/ [S]
- D5 https://voicebot.ai/2018/11/25/video-shows-google-duplex-making-a-real-restaurant-reservation-says-it-is-google-calling-and-the-call-will-be-recorded-full-analysis/ [S] (Cafe Prague)
- D6 https://techcrunch.com/2019/04/03/a-i-powered-booking-service-google-duplex-rolls-out-to-ios-android-5-0-devices [S]
- D7 https://techcrunch.com/2018/05/18/what-we-know-about-googles-duplex-demo-so-far [S]
- D8 https://www.foxnews.com/tech/hate-making-phone-calls-google-assistant-can-do-it-for-you [S]
- G1 https://support.google.com/phoneapp/answer/10071878?hl=en [P] (Hold for Me)
- G2 https://support.google.com/phoneapp/answer/9118387?hl=en [P] (Call Screen)
- G3 https://blog.google/products/pixel/pixel-call-assist-call-notes-tips/ [P]
- A1 https://www.apple.com/newsroom/2025/06/apple-elevates-the-iphone-experience-with-ios-26/ [P]
- A2 https://support.apple.com/guide/iphone/screen-and-block-calls-iphe4b3f7823/26/ios/26 [P]
- A3 https://support.apple.com/en-us/127521 [P] (Hold Assist, published 2026-07-10)
- A4 https://support.apple.com/en-au/guide/phoneapp/phn4828a6 [P] (Mac Phone guide)
- A5 https://www.thestar.com.my/tech/tech-news/2025/10/10/one-tech-tip-annoyed-by-junk-calls-to-your-iphone-try-the-new-ios-26-call-screen-feature [S] (AP)
- H https://developer.apple.com/design/human-interface-guidelines/ pages, read through developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json [P]
- X1 https://amazonappdev2026.devpost.com/ and /rules [P]
- X2 https://community.amazondeveloper.com/t/build-ship-shape-amazon-developer-hackathon/29098 [P]
- X3 https://alexaskillsaging.devpost.com/ and /project-gallery?winner=true [P]
- X4 https://voicebot.ai/2022/10/13/amazon-announces-aging-engaging-alexa-skills-challenge-winners/ [S]

---

## 1. Google Duplex (I/O 2018)

### 1.1 Disclosure at the demo

- The demo calls did not disclose an AI. Casey Johnston, on a podcast: the person at the salon "doesn't know that they're talking to a robot. There is no indicator." [D2]
- The recordings were edited. Bloomberg, via 9to5Google: edited "to protect the identity of the businesses involved." [D3]
- Nobody who answered named their business. TechCrunch: "nobody who answers the calls ... identifies their name or the name of the business." [D7]
- Google's blog promised only this: "We want to be clear about the intent of the call so businesses understand the context. We'll be experimenting with the right approach over the coming months." [D1]

### 1.2 Later policy change

- Google's first statement was vague: "we'll make sure the system is appropriately identified." (TechCrunch, 2018-06-27: https://techcrunch.com/2018/06/27/a-closer-look-at-google-duplex/ [S])
- At an all-hands, Google "reiterated that Assistant would explicitly identify itself at the top of the call." Two-party consent states (the article says 11) also get a recording notice. [D3]
- Tested wording: "Hi! I'm the Google Assistant calling to make a reservation for a client. Umm. This automated call will be recorded." If a business objected, Duplex ended the call and a human operator took over. [D4]
- Real call, November 2018 (VentureBeat test): "Hi, I am calling to make a reservation for a client. I'm calling from Google, so the call may be recorded." This line names Google and the recording. It does not say "AI". [D5]
- At launch, Google "added a message at the start of the call that says the call is from Google, and explains why the call is being placed", and let businesses opt out. [D6]
- No source I fetched shows an explicit "I am an AI" line. Any later policy is UNVERIFIED.

### 1.3 How Duplex confirms details

- In the salon demo the **business** reads the booking back. The Assistant does not. The salon says "So I will see Lisa at 10 o' clock on May 3rd." The Assistant says "OK great. Thanks." [D2]
- In the post-launch Cafe Prague call the hostess reads back "Two people tomorrow at 7 p.m." and "Anna." Duplex says "Okay." [D5]
- Restaurant demo: the host heard "Wednesday the 7th" as seven people. The Assistant corrected it to four, learned that only larger parties could book, and asked about wait times (PCMag, via Fox). [D8]
- User side, 2019: the Assistant "confirms details like booking time and size of party" with the user first. [D6]

### 1.4 Disfluencies and latency

- Deliberate. Google: "speech disfluencies (e.g. 'hmm's and 'uh's). These are added when combining widely differing sound units in the concatenative TTS or adding synthetic waits, which allows the system to signal in a natural way that it is still processing." [D1]
- Fast path: "This allows us to have less than 100ms of response latency in these situations" (simple turns such as "hello?"). [D1]
- Slow path: "in some situations, we found it was actually helpful to introduce more latency ... when replying to a really complex sentence." [D1]
- Scope: Duplex is constrained to "closed domains". Human operators finish tasks it cannot. [D1]
- Cafe Prague call: about 37 seconds. [D5]

### 1.5 Transcript lines

Salon call, played by Sundar Pichai. Auto-transcribed; punctuation is the transcriber's. [D2]

> Salon: How can I help you?
> Google Assistant: Hi, I'm calling to book a women's haircut for a client.
> Salon: Sure, what time are you looking for around?
> Google Assistant: At 12pm.
> Salon: We do not have a 12pm available, the closest we have to that is a 1:15pm.
> Google Assistant: Do you have anything between 10 a.m. and 12 p.m?
> Salon: Depending on what service she would like. What service is she looking for?
> Google Assistant: Just a woman haircut for now.
> Salon: OK, we have a 10 o clock?
> Google Assistant: 10am is fine.
> Salon: What's her first name?
> Google Assistant: The first name is Lisa.
> Salon: OK perfect. So I will see Lisa at 10 o' clock on May 3rd.
> Google Assistant: OK great. Thanks.
> Salon: Great, have a great day bye.

- This text omits the "Mm-hmm" moment. A Digital Trends snippet says the salon said "Give me one second" and the Assistant said "Mm-hmm". [SNIP] UNVERIFIED.
- Verbatim I/O restaurant call: UNVERIFIED.

---

## 2. Pixel Hold for Me and Call Screen

### 2.1 Hold for Me [G1]

- Setup: Phone > More > Settings > Hold for Me. Then, per call, tap "Hold for me" and "Start". The setting alone is not enough.
- While waiting, a card reads **"Don't hang up"**.
- When a person returns, the prompt reads **"Someone's waiting to talk to you."** The user taps **"Return to call"**.
- The user must take the phone off silent or vibrate-only.
- Limits, quoted: "Hold for Me may not detect every on-hold scenario." It may also miss the representative's return. No music or other audio can play during it.
- What the business hears: "Hold for Me will inform them you're returning and notify you that they're ready." [G3] The spoken string is UNVERIFIED.
- An on-screen transcript during hold is not documented. UNVERIFIED.

### 2.2 Call Screen [G2]

- It "works on your device and doesn't use Wi-Fi or mobile data".
- Automatic mode: a silent notification reads **"Screening unknown number"** or **"Screening suspicious call"**. Tapping it shows a live transcript between caller and Call Assist.
- Call Assist "asks who's calling and why". Spam: the phone hangs up. Not spam: the phone rings and shows the caller's answer.
- Manual mode: tap **"Screen call"**. The user gets "a real-time transcript of how the caller responds", then picks a reply, answers, or hangs up.
- Canned replies, button → what the caller hears:
  - "Is it urgent?" → "Do you need to get a hold of them urgently?"
  - "I'll call you back" → "They can't talk right now, but they'll give you a call later. Thanks, and goodbye."
  - Two more exist: "Report as spam" and "I can't understand".
- AI replies run on device. Google warns: "Replies may be inaccurate and don't represent Google's views."
- Every screened call saves a transcript. Audio is optional.

---

## 3. Apple iOS 26 (WWDC25)

### 3.1 Call Screening

- Apple: "Call Screening builds on Live Voicemail and helps eliminate interruptions by gathering information from the caller and giving users the details they need to decide if they want to pick up or ignore the call." [A1]
- Apple: "Call Screening automatically answers calls from unknown numbers without interrupting you. Once the caller shares their name and reason for their call, your iPhone rings and shares their response so you can decide if you want to pick up." [A2]
- Setting: Settings > Apps > Phone. Choices: **"Never"**, **"Ask Reason for Calling"**, **"Silence"**. [A2]
- Caller hears: a Siri-style voice asks for name and purpose. [A5] Apple's exact spoken script is UNVERIFIED.
- User sees: a notice that the call is being screened, then the caller's answers as transcribed speech bubbles. [A5]

### 3.2 Hold Assist [A3]

- "With Hold Assist, your phone notifies you when a live call is no longer on hold."
- Start: tap More, then **"Hold Assist"**. Or accept the prompt when the phone detects hold. "Hold Assist Detection is turned on by default."
- "Make sure your phone is set to ring, then step away. When your device detects that a live agent is available, you're alerted to join the call. You also see a transcript of anything that you missed."
- "The real-time transcription is processed entirely on device, discards when the call connects, and is not stored by Apple."
- "Tap to rejoin the call when ready. The call is not recorded."
- Mac: on silent or Do Not Disturb, "you won't hear the incoming call when an agent is available." [A4]
- What the agent hears: UNVERIFIED. A Live Activity during hold: third-party snippet only, UNVERIFIED against Apple.

### 3.3 HIG guidance [H]

**Notifications**
- "Provide concise, informative notifications."
- "Avoid sending multiple notifications for the same thing, even if someone hasn't responded."
- "Avoid including sensitive, personal, or confidential information in a notification."

**Live Activities**
- "Focus on important information that people need to see at a glance."
- "Update a Live Activity only when new content is available."
- "Alert people only for essential updates that require their attention."
- "Always end a Live Activity immediately when the task or event ends."

**Confirming actions with consequences**
- Generative AI: "Consider consequences and get permission before performing irreversible or potentially problematic tasks." It cites "actions that are hard to undo, like making a purchase on a person's behalf" and says "Generally, ask for confirmation before performing a significant action on someone's behalf."
- Generative AI: offer "Edit, Undo, Retry, or Adjust" and "acknowledge when their corrections take effect".
- Alerts: "Avoid using OK as the default button title unless the alert is purely informational." Use specific titles ("Erase", "Delete"). Add "Cancel" for destructive actions. Alert for "uncommon destructive action[s] that they can't undo", not for undoable ones.
- Notifications: "Prefer nondestructive actions. If you must provide a destructive action, make sure people have enough context to avoid unintended consequences."

---

## 4. Alexa hackathons on Devpost

### 4.1 Which event

- Newest: **Build, Ship, Shape: Amazon Developer Hackathon**. Open now. Deadline 2026-10-23 12:00 pm PT. Winners "on or around" 2026-12-03. No winners exist yet. [X1]
- Most recent Alexa event with winners: **Amazon Alexa Skills Challenge: Aging & Engaging**, 2022-08-01 to 2022-09-26. [X3] I found it through Devpost's list of ended "alexa" hackathons. Whether a later one exists elsewhere is UNVERIFIED.

### 4.2 Aging & Engaging: prizes and criteria [X3]

- 762 participants. $45,000 in prizes. Theme: skills for adults 55 and older.
- Prizes: Grand Prize $15,000 (1). Runner Ups $5,000 (4). Category prizes $2,000 each for Keep Moving, Stay Sharp, Be Supported, Let's Connect. Bonus Best Multi-Modal Skill $2,000.
- Submission: a video "(about 3 minutes)" on YouTube, Vimeo or Facebook; Skill ID; proof of store submission.
- Criteria, quoted in part:
  - **Quality of the Submission**: "uniqueness, creativity, and ingenuity ... ease-of-use, and whether the skill is conversational and contextual."
  - **Technical and Design Implementation**: "conversation design principles such as cooperation, trust, brevity, and dialogue written for how we speak."
  - **Potential Impact**: "extent to which the skill can engage, entertain, assist, and/or educate ... potential to scale."

### 4.3 Winners [X3, prize mapping X4]

- **Family Journal** (Grand Prize): private family feed; relatives post images and text to an Echo. https://devpost.com/software/family-journal-zsl9ov
- **VoicePT** (Runner Up): multimodal voice guide for home physical therapy. https://devpost.com/software/voicept
- **FingerString Appointments** (Runner Up; Best Be Supported): add appointments by voice; the service phones the senior. https://devpost.com/software/fingerstring-appointments
- **Brain Games** (Runner Up): brain-training games for 55+. https://devpost.com/software/brain-games-ageing-and-engaging
- **Memories** (Runner Up): family media with quiz and slideshow modes. https://devpost.com/software/my-memories
- **Senior Stretch** (Best Keep Moving): guided stretching. URL not captured, UNVERIFIED.
- **Your Memory Challenge** (Best Stay Sharp): five stories, then five questions. https://devpost.com/software/your-memory-challenge
- **Storyteller Cafe** (Best Let's Connect): four virtual friends against isolation. https://devpost.com/software/storyteller-cafe-version-2-0
- **Cash Register** (Best Multi-Modal): Alexa device as a point of sale. https://devpost.com/software/cash-register

No page I read links a GitHub repo. Family Journal links familyjournal.me. Public repos are UNVERIFIED.

### 4.4 Top three: what the pages show

Devpost does not rank the runner-ups. I took the Grand Prize winner plus two runner-ups.

| Project | Video | Length (YouTube metadata) | Page format |
|---|---|---|---|
| Family Journal | https://www.youtube.com/watch?v=d0pIz40_4NI | 1 min 41 s | Standard Devpost headings, short prose. Stack in two sentences (Alexa Hosted Skill, plus Lambda, DynamoDB, API Gateway, CloudFront). No diagram. Admits push notifications were limited to hospitality partners. |
| VoicePT | https://www.youtube.com/watch?v=NpS4RKLJqQE | 3 min 0 s | Long founder story, one adherence statistic ("only 35% ... complete their prescribed physical therapy programs at home"), accessibility list, stack paragraph (Voiceflow, Airtable, Rails, Heroku, S3). Dated timeline. No diagram. |
| FingerString Appointments | https://www.youtube.com/watch?v=vO0vbK-YZf4 | 3 min 6 s | Seven one-line sections. Stack in one sentence (node.js, REST). One honest bug: time-zone mapping. |

Pattern: a real-user story, a plain stack list, an honest "Challenges" line, and a video near or under 3 minutes. None shows an architecture diagram on its page.

### 4.5 Build, Ship, Shape rules [X1]

**Dates.** Submit 2026-08-31 to 2026-10-23 12:00 pm PT. Judge 2026-11-09 to 2026-11-20.

**Alexa+ track.** "A working Agent Skill or a self-hosted MCP server, implementing MCP spec version 2025-11-25 ... over Streamable HTTP." Or "a simulated Alexa+ experience", where "the code repository must still include the simulation's source code, and the demo video must clearly show the simulated experience."

**Judging.** Stage One is pass/fail on theme fit and use of the required tech. Stage Two uses "equally weighted criteria":
- **Tech Implementation**: "How well is the project built, and how effectively does it use the required tech?"
- **Design**: "Does the project deliver a complete, coherent product experience? Is the interaction model intuitive and well-considered for the target device or platform?"
- **Potential Impact**: "Does the project make a credible, specific case for solving customer needs? Could it realistically serve an audience beyond the hackathon?"
- **Quality of the Idea**: "Is this a creative, imaginative use of the required tools?"
- Alexa+ "Obvious": "single-turn Q&A bot, basic MCP wrapper around an existing API." "Creative": "agentic workflow that orchestrates across services autonomously, context-aware add-on that maintains state across sessions, purchasing capabilities ..."

**Friction log.** "Optional – Friction Log Entries: specific task attempted, steps taken, expected vs. actual result, severity rating, workaround used, and actionable suggestion. Participants who submit friction logs score higher in judging (up to 10% bonus)." Amazon's internal team sets the bonus in Stage 1. The Stage 2 panel adds it to the final score. [X2] lists "cryptic errors, broken dependencies, and outdated docs" as examples.

**Product Feedback (required).** Per tool: what you used it for; what worked; what needs work; onboarding; "Would you build with these devices and services again? Yes/No and please tell us why".

**Submission.**
- A text description of "features and functionality".
- A GitHub repo. Public with a detectable open-source license, or private and shared with the named Amazon reviewers. It needs "clear setup and run instructions".
- Alexa+ repos must call the track tech at runtime, "not just named in the README". The simulated path is exempt.
- A demo video "less than three (3) minutes. Judges are not required to watch beyond three minutes". Public on YouTube or Vimeo. It must show the project on its intended platform. No third-party trademarks or copyrighted music.
- English, or a translation.

**Prizes, Alexa+.** 1st $25,000 cash + $15,000 AWS credits + Amazon meeting. 2nd $15,000 + $5,000. 3rd $4,000 + $1,000. Mini challenges (AWS Builder, Open Source): $5,000 cash + $5,000 credits each.

---

## Facts I could not verify

1. Verbatim I/O restaurant call.
2. The "Give me one second" and "Mm-hmm" lines (snippet only).
3. Any Google statement that Duplex says "I am an AI".
4. The spoken string a business hears from Hold for Me, and Apple's spoken Call Screening script.
5. What an agent hears when Hold Assist ends. A Hold Assist Live Activity in Apple's own docs.
6. Senior Stretch's URL. Public repos for the Aging & Engaging winners.
7. Whether a later Alexa hackathon with winners exists beyond Devpost's list.
8. Ranking among the four runner-ups.
