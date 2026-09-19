/*
 * Forbidden Five — the word-twisting party game, rebuilt for one phone.
 *
 * One team's clue-giver holds the handset and has to talk their team onto the
 * word printed across the top of the card without ever saying it, or any of
 * the five words listed underneath. The other team reads the same screen over
 * their shoulder and hits the buzzer the moment a forbidden word slips out.
 *
 * Packaged assets are disabled (maxAssets: 0), so the card stock, the buzzer,
 * the countdown tick and the winner's fanfare are all built here: layout in
 * DOM and CSS, sound synthesised through WebAudio.
 */

window.plethoraBit = {
  meta: {
    title: "Forbidden Five",
    runtime: "plethora-bit@2",
    tags: [
      "party", "word-game", "guessing", "teams", "pass-and-play",
      "local-multiplayer", "social", "family", "timer", "cards"
    ],
    permissions: ["audio", "haptics", "storage"]
  },

  async init(ctx) {
    /* ================================================================ *
     * THE DECKS
     * One card per line: the word to land, then the five words that are
     * off limits, pipe separated. A clue-giver may not say any of them,
     * nor any part of the answer itself — that rule lives in the room,
     * not in the code, exactly as it does across a kitchen table.
     * ================================================================ */
    const DECKS = [
      { id: "classic", name: "Classic", raw: `
APPLE|RED|FRUIT|PIE|CIDER|CORE
PILLOW|SLEEP|BED|SOFT|HEAD|FEATHER
UMBRELLA|RAIN|OPEN|WET|HANDLE|COVER
TOOTHBRUSH|TEETH|PASTE|BRUSH|MOUTH|CLEAN
ELEPHANT|TRUNK|GRAY|BIG|AFRICA|TUSK
GUITAR|STRINGS|PLAY|MUSIC|ROCK|STRUM
BEACH|SAND|SEA|SUN|TOWEL|WAVES
LADDER|CLIMB|STEPS|TALL|RUNGS|REACH
MIRROR|REFLECT|GLASS|LOOK|FACE|BATHROOM
WINTER|COLD|SNOW|SEASON|ICE|SCARF
DOCTOR|HOSPITAL|SICK|PATIENT|MEDICINE|NURSE
BUTTERFLY|WINGS|CATERPILLAR|FLY|INSECT|COCOON
KEYBOARD|TYPE|KEYS|COMPUTER|LETTERS|PIANO
BIRTHDAY|CAKE|CANDLES|PRESENT|AGE|PARTY
SOAP|WASH|BUBBLES|CLEAN|HANDS|BATH
VOLCANO|LAVA|ERUPT|MOUNTAIN|ASH|HOT
WEDDING|MARRY|BRIDE|RING|CHURCH|DRESS
PENGUIN|ANTARCTICA|BLACK|WHITE|SWIM|BIRD
SCISSORS|CUT|PAPER|SHARP|BLADES|SNIP
THUNDER|LIGHTNING|STORM|LOUD|RAIN|SKY
BICYCLE|PEDAL|WHEELS|RIDE|CHAIN|HANDLEBARS
HONEY|BEES|SWEET|STICKY|JAR|GOLDEN
LIBRARY|BOOKS|QUIET|BORROW|SHELVES|READ
SNOWMAN|CARROT|BUILD|WINTER|MELT|SCARF
DENTIST|TEETH|DRILL|CHAIR|MOUTH|FILLING
RAINBOW|COLORS|RAIN|SKY|ARCH|POT
VACUUM|CLEAN|CARPET|SUCK|DUST|FLOOR
KANGAROO|AUSTRALIA|HOP|POUCH|JUMP|TAIL
CANDLE|WAX|FLAME|LIGHT|WICK|BLOW
POSTCARD|HOLIDAY|STAMP|WRITE|SEND|PICTURE
HAMMER|NAIL|HIT|TOOL|WOOD|THUMB
GIRAFFE|NECK|TALL|SPOTS|AFRICA|LEAVES
BALLOON|AIR|POP|FLOAT|PARTY|HELIUM
SUNGLASSES|EYES|SUN|WEAR|SHADES|BRIGHT
FIREWORKS|BANG|SKY|EXPLODE|NIGHT|DISPLAY
GLOVES|HANDS|WARM|FINGERS|PAIR|WEAR
ALARM|CLOCK|WAKE|LOUD|MORNING|RING
SPIDER|WEB|LEGS|EIGHT|CRAWL|SCARY
WALLET|MONEY|POCKET|CARDS|LEATHER|CASH
ANCHOR|BOAT|HEAVY|SEA|CHAIN|DROP
CHIMNEY|SMOKE|ROOF|SANTA|FIRE|BRICK
BLANKET|WARM|BED|COVER|WOOL|WRAP
FOOTPRINT|FOOT|SAND|TRACK|WALK|MARK
LIGHTHOUSE|SEA|LIGHT|SHIPS|ROCKS|TOWER
MAGNET|ATTRACT|METAL|FRIDGE|STICK|POLE
NURSE|HOSPITAL|DOCTOR|PATIENT|CARE|UNIFORM
OCTOPUS|EIGHT|ARMS|SEA|INK|TENTACLES
PARACHUTE|JUMP|PLANE|FALL|SKY|OPEN
QUEEN|KING|CROWN|ROYAL|THRONE|PALACE
ROBOT|MACHINE|METAL|HUMAN|PROGRAM|FUTURE
SHADOW|SUN|DARK|FOLLOW|LIGHT|OUTLINE
TELESCOPE|STARS|LOOK|SPACE|LENS|NIGHT
VIOLIN|BOW|STRINGS|ORCHESTRA|PLAY|MUSIC
WHISTLE|BLOW|SOUND|REFEREE|LOUD|MOUTH
ZIPPER|JACKET|UP|DOWN|TEETH|STUCK
ANGEL|WINGS|HEAVEN|HALO|WHITE|FLY
BUTTON|SHIRT|PRESS|HOLE|SEW|PUSH
CACTUS|DESERT|SPIKES|PLANT|WATER|PRICKLY
DIARY|WRITE|SECRET|DAY|LOCK|PAGES
ENVELOPE|LETTER|STAMP|SEAL|POST|OPEN
FEATHER|BIRD|LIGHT|SOFT|FLY|QUILL
GHOST|SCARY|WHITE|HAUNT|SHEET|DEAD
HELMET|HEAD|PROTECT|BIKE|HARD|WEAR
IGLOO|ICE|ESKIMO|SNOW|HOUSE|COLD
JUNGLE|TREES|ANIMALS|GREEN|TARZAN|WILD
KITE|WIND|FLY|STRING|SKY|TAIL
LEMON|SOUR|YELLOW|FRUIT|JUICE|SQUEEZE
MOUSTACHE|FACE|HAIR|LIP|SHAVE|MEN
NEEDLE|THREAD|SEW|SHARP|EYE|PIN
ORCHESTRA|MUSIC|CONDUCTOR|PLAY|VIOLIN|INSTRUMENTS
PYRAMID|EGYPT|TRIANGLE|PHARAOH|STONE|TOMB
QUILT|BLANKET|PATCHES|SEW|BED|WARM
RAINCOAT|WET|WEAR|RAIN|WATERPROOF|HOOD
SADDLE|HORSE|RIDE|LEATHER|SIT|STIRRUP
TATTOO|INK|SKIN|NEEDLE|PERMANENT|DESIGN
UNICORN|HORN|HORSE|MAGIC|MYTH|WHITE
VASE|FLOWERS|WATER|GLASS|BREAK|TABLE
WHEELBARROW|GARDEN|PUSH|WHEEL|DIRT|CARRY
YAWN|TIRED|MOUTH|SLEEPY|OPEN|CONTAGIOUS
ZEBRA|STRIPES|BLACK|WHITE|AFRICA|HORSE
ACORN|OAK|TREE|SQUIRREL|NUT|SEED
BADGE|POLICE|PIN|WEAR|OFFICER|METAL
CAMPFIRE|WOOD|BURN|MARSHMALLOW|TENT|WARM
DRAGON|FIRE|WINGS|SCALES|MYTH|BREATHE
ECHO|SOUND|REPEAT|CAVE|SHOUT|BACK
FOSSIL|BONE|DINOSAUR|ROCK|OLD|DIG
GLACIER|ICE|MELT|MOUNTAIN|SLOW|COLD
HAMMOCK|SWING|TREES|LIE|ROPE|RELAX
ICEBERG|TITANIC|FLOAT|COLD|TIP|OCEAN
JIGSAW|PUZZLE|PIECES|FIT|PICTURE|TABLE
KNOT|TIE|ROPE|UNDO|TIGHT|SHOELACE
LULLABY|SONG|SLEEP|BABY|SING|SOFT
MUMMY|EGYPT|WRAP|BANDAGE|TOMB|DEAD
NEST|BIRD|EGGS|TWIGS|TREE|BUILD
OASIS|DESERT|WATER|PALM|MIRAGE|SAND
PUPPET|STRINGS|HAND|SHOW|PULL|WOOD
QUICKSAND|SINK|SAND|TRAP|STUCK|SLOW
RUST|METAL|ORANGE|OLD|WATER|CORRODE
SCARECROW|FIELD|BIRDS|STRAW|HAT|FARM
PARADE|MARCH|STREET|FLOATS|BAND|CROWD
UMPIRE|REFEREE|GAME|DECISION|CRICKET|CALL
VOLLEYBALL|NET|BEACH|BALL|TEAM|SPIKE
WATERFALL|RIVER|FALL|CLIFF|SPLASH|NIAGARA
XYLOPHONE|BARS|HIT|MUSIC|WOOD|MALLET
YACHT|BOAT|SAIL|RICH|SEA|LUXURY
ZOO|ANIMALS|CAGE|VISIT|KEEPER|LION
APRON|COOK|KITCHEN|TIE|MESSY|WEAR
BRUISE|PURPLE|SKIN|HURT|BUMP|MARK
COMPASS|NORTH|DIRECTION|NEEDLE|MAP|LOST
DUNGEON|CASTLE|PRISON|DARK|UNDER|CHAINS
EARTHQUAKE|SHAKE|GROUND|CRACK|RICHTER|DISASTER
FIREPLACE|WOOD|WARM|CHIMNEY|BURN|MANTEL
GOSSIP|TALK|RUMOR|SECRET|SPREAD|WHISPER
HICCUP|BREATH|SOUND|WATER|CURE|SPASM
INVENTION|CREATE|NEW|PATENT|IDEA|EDISON
JOURNAL|WRITE|DIARY|PAGES|DAILY|RECORD
KETTLE|BOIL|WATER|TEA|WHISTLE|POUR
LAUNDRY|WASH|CLOTHES|MACHINE|DRY|BASKET
MARATHON|RUN|RACE|MILES|FINISH|LONG
NOSTALGIA|PAST|MEMORY|MISS|CHILDHOOD|FEELING
OVERTIME|WORK|EXTRA|HOURS|PAY|LATE
PICNIC|BASKET|PARK|FOOD|BLANKET|OUTSIDE
QUARANTINE|ISOLATE|SICK|STAY|HOME|VIRUS
RECIPE|COOK|INGREDIENTS|STEPS|BOOK|FOLLOW
SUNBURN|RED|SUN|SKIN|PEEL|CREAM
TOOTHACHE|TOOTH|PAIN|DENTIST|HURT|MOUTH
UNIFORM|WEAR|SCHOOL|SAME|WORK|CLOTHES
VOLUNTEER|FREE|HELP|CHARITY|UNPAID|OFFER
WHISPER|QUIET|SOFT|SECRET|EAR|TALK
` },
      { id: "food", name: "Food & Drink", raw: `
PIZZA|ITALY|CHEESE|SLICE|DELIVERY|TOPPINGS
POPCORN|CINEMA|CORN|POP|BUTTER|SALT
SUSHI|JAPAN|RICE|FISH|RAW|CHOPSTICKS
PANCAKE|FLAT|SYRUP|FLIP|BATTER|BREAKFAST
BARBECUE|GRILL|MEAT|SUMMER|SMOKE|COALS
SPAGHETTI|PASTA|ITALIAN|SAUCE|LONG|FORK
CHOCOLATE|SWEET|BROWN|COCOA|BAR|MELT
BREAKFAST|MORNING|EGGS|FIRST|MEAL|CEREAL
SANDWICH|BREAD|FILLING|LUNCH|SLICES|BUTTER
ICE CREAM|COLD|CONE|SCOOP|MELT|VANILLA
COFFEE|CAFFEINE|MORNING|BEANS|CUP|BLACK
GARLIC|SMELL|CLOVE|BREATH|VAMPIRE|COOK
PEANUT|BUTTER|NUT|ALLERGY|SHELL|SALTED
MICROWAVE|HEAT|FAST|BEEP|OVEN|MINUTES
SALAD|GREEN|LETTUCE|HEALTHY|BOWL|DRESSING
CHEESEBURGER|BUN|PATTY|CHEESE|FAST|BEEF
LEFTOVERS|FRIDGE|YESTERDAY|REHEAT|FOOD|MEAL
TAKEAWAY|ORDER|DELIVERY|BOX|RESTAURANT|HOME
WAFFLE|SQUARES|IRON|SYRUP|BREAKFAST|BELGIAN
SMOOTHIE|BLEND|FRUIT|DRINK|THICK|STRAW
CINNAMON|SPICE|BROWN|STICK|BUN|SWEET
PICKLE|SOUR|CUCUMBER|JAR|VINEGAR|BURGER
OMELETTE|EGGS|PAN|FOLD|FILLING|BREAKFAST
CEREAL|MILK|BOWL|BREAKFAST|BOX|CRUNCH
TOAST|BREAD|BROWN|BUTTER|POP|BREAKFAST
YOGURT|MILK|POT|SPOON|GREEK|CULTURE
MUSTARD|YELLOW|HOTDOG|SPICY|SAUCE|JAR
BROCCOLI|GREEN|TREE|VEGETABLE|KIDS|HEALTHY
LOBSTER|RED|CLAWS|SEA|EXPENSIVE|SHELL
DOUGHNUT|HOLE|SUGAR|RING|FRIED|GLAZE
NOODLES|CHINESE|LONG|SLURP|BOWL|INSTANT
CURRY|SPICY|INDIAN|RICE|SAUCE|HOT
PRETZEL|SALT|TWIST|GERMAN|BREAD|KNOT
KETCHUP|TOMATO|RED|BOTTLE|FRIES|SAUCE
CUPCAKE|SMALL|FROSTING|CAKE|PAPER|BAKE
VEGETARIAN|MEAT|DIET|PLANTS|VEGGIE|NO
BUFFET|ALL|EAT|PLATE|CHOICE|QUEUE
CHOPSTICKS|ASIAN|EAT|WOOD|TWO|RICE
HANGOVER|DRINK|HEADACHE|MORNING|ALCOHOL|REGRET
MARSHMALLOW|WHITE|SOFT|CAMPFIRE|ROAST|SWEET
CAVIAR|FISH|EGGS|EXPENSIVE|LUXURY|BLACK
PEPPERMINT|MINT|GREEN|FRESH|CANDY|BREATH
SODA|FIZZY|CAN|SUGAR|DRINK|BUBBLES
BAGEL|HOLE|BREAD|RING|CREAM|NEW YORK
HOTDOG|SAUSAGE|BUN|MUSTARD|STAND|BASEBALL
GRAVY|BROWN|SAUCE|ROAST|POUR|DINNER
` },
      { id: "screen", name: "Screen & Stage", raw: `
FRONT ROW|SEAT|CLOSE|SCREEN|FIRST|NECK
SUPERHERO|CAPE|POWERS|SAVE|COMIC|VILLAIN
SEQUEL|TWO|FOLLOW|MOVIE|AGAIN|ORIGINAL
KARAOKE|SING|MICROPHONE|WORDS|BAR|SCREEN
SPOILER|ENDING|REVEAL|ALERT|RUIN|PLOT
BOX OFFICE|MONEY|TICKETS|MOVIE|EARN|HIT
STAND UP|COMEDY|JOKES|MICROPHONE|LAUGH|CLUB
SOUNDTRACK|MUSIC|MOVIE|SONGS|ALBUM|SCORE
AUDITION|TRY|PART|ACTOR|ROLE|CASTING
BLOCKBUSTER|BIG|MOVIE|HIT|SUMMER|MILLIONS
CLIFFHANGER|ENDING|SUSPENSE|NEXT|EPISODE|WAIT
DOCUMENTARY|REAL|FILM|FACTS|NARRATOR|TRUE
ENCORE|AGAIN|CONCERT|MORE|CLAP|END
FESTIVAL|MUSIC|TENTS|BANDS|MUD|SUMMER
GROUPIE|FAN|BAND|FOLLOW|BACKSTAGE|OBSESSED
HEADLINER|MAIN|ACT|LAST|BIGGEST|STAGE
IMPROV|UNSCRIPTED|COMEDY|MAKE|STAGE|SPOT
JINGLE|ADVERT|CATCHY|SHORT|TUNE|BRAND
LIP SYNC|MOUTH|WORDS|FAKE|SING|MIME
MUSICAL|SING|DANCE|STAGE|SONGS|BROADWAY
NARRATOR|VOICE|STORY|TELL|OVER|BOOK
BACKSTAGE|BEHIND|ACTORS|PASS|CURTAIN|DRESSING
PAPARAZZI|PHOTOS|CELEBRITY|CHASE|CAMERA|FAME
QUIZ SHOW|QUESTIONS|ANSWERS|HOST|PRIZE|TV
RED CARPET|CELEBRITY|WALK|PHOTOS|PREMIERE|DRESS
STUNT DOUBLE|ACTOR|DANGEROUS|REPLACE|FALL|SCENE
TRAILER|PREVIEW|MOVIE|SHORT|COMING|CLIPS
UNDERSTUDY|BACKUP|ACTOR|ROLE|SICK|REPLACE
VILLAIN|BAD|HERO|EVIL|DEFEAT|PLOT
WARDROBE|CLOTHES|COSTUME|CHANGE|ACTOR|ROOM
BINGE WATCH|EPISODES|ROW|NETFLIX|ALL|NIGHT
CAMEO|SHORT|APPEAR|FAMOUS|SCENE|BRIEF
DUBBING|VOICE|LANGUAGE|MOUTH|OVER|TRANSLATE
BOX SET|EPISODES|SERIES|ALL|BUY|WATCH
FLASHBACK|PAST|SCENE|MEMORY|EARLIER|CUT
GAME SHOW|PRIZES|HOST|CONTESTANT|TV|BUZZER
INTERMISSION|BREAK|HALF|THEATER|DRINKS|PAUSE
MONTAGE|CLIPS|MUSIC|TRAINING|QUICK|SCENES
OPENING NIGHT|FIRST|SHOW|NERVES|AUDIENCE|PREMIERE
PLOT TWIST|SURPRISE|ENDING|SHOCK|STORY|UNEXPECTED
REALITY TV|CAMERAS|REAL|HOUSE|DRAMA|CONTESTANTS
SITCOM|COMEDY|EPISODE|LAUGH|TV|SERIES
TEARJERKER|CRY|SAD|MOVIE|TISSUES|EMOTIONAL
VOICEOVER|NARRATE|SPEAK|OVER|MICROPHONE|RECORD
WHODUNIT|MYSTERY|MURDER|DETECTIVE|SOLVE|CLUES
` },
      { id: "world", name: "Out In The World", raw: `
PASSPORT|TRAVEL|STAMP|COUNTRY|PHOTO|BORDER
JET LAG|TIME|TIRED|FLIGHT|ZONE|SLEEP
SOUVENIR|BUY|HOLIDAY|MEMORY|GIFT|TRIP
SAFARI|AFRICA|ANIMALS|JEEP|LIONS|TOUR
SKI LIFT|MOUNTAIN|UP|CHAIR|SNOW|DANGLE
SNORKEL|SEA|BREATHE|TUBE|MASK|SWIM
HOSTEL|CHEAP|BUNK|BACKPACKER|SHARE|STAY
CAMPING|TENT|OUTSIDE|SLEEP|FIRE|BAGS
DESERT|SAND|HOT|DRY|CAMEL|DUNES
SNOWSHOE|WALK|SNOW|WIDE|SINK|FEET
RAINFOREST|TREES|WET|AMAZON|HUMID|CANOPY
CORAL REEF|FISH|COLOR|SEA|DIVE|BLEACH
NORTHERN LIGHTS|SKY|GREEN|NORWAY|NIGHT|AURORA
TIDE|SEA|IN|OUT|MOON|BEACH
AVALANCHE|SNOW|MOUNTAIN|SLIDE|BURY|DANGER
MONSOON|RAIN|SEASON|ASIA|FLOOD|WET
CANYON|DEEP|ROCK|GRAND|RIVER|WALLS
FJORD|NORWAY|WATER|CLIFFS|NARROW|BOAT
FINISH LINE|END|RACE|TAPE|CROSS|FIRST
PENALTY|FOOTBALL|SPOT|KICK|GOAL|FOUL
OFFSIDE|FOOTBALL|FLAG|LINE|RULE|REFEREE
HAT TRICK|THREE|GOALS|SCORE|MATCH|PLAYER
SLAM DUNK|BASKETBALL|HOOP|JUMP|BALL|SCORE
HOME RUN|BASEBALL|BAT|BALL|BASES|SCORE
SCRUM|RUGBY|PUSH|BALL|PACK|PLAYERS
TOUR DE FRANCE|CYCLING|YELLOW|RACE|FRANCE|BIKE
OLYMPICS|MEDALS|RINGS|COUNTRIES|GAMES|FOUR
REFEREE|WHISTLE|RULES|GAME|CARD|DECISION
SUBSTITUTE|BENCH|SWAP|PLAYER|ON|OFF
PODIUM|WINNER|THREE|STAND|MEDAL|TOP
HIGH JUMP|BAR|LEAP|ATHLETICS|BACK|HEIGHT
GOAL KEEPER|GLOVES|SAVE|NET|FOOTBALL|POST
TIE BREAK|TENNIS|EQUAL|EXTRA|DECIDE|POINTS
LOVE|TENNIS|ZERO|SCORE|NOTHING|POINT
HAILSTORM|ICE|SKY|FALL|WEATHER|BALLS
TORNADO|SPIN|WIND|FUNNEL|KANSAS|DESTROY
DROUGHT|NO|RAIN|DRY|CROPS|WATER
TSUNAMI|WAVE|OCEAN|EARTHQUAKE|FLOOD|GIANT
MIGRATION|BIRDS|MOVE|SEASON|SOUTH|FLY
HIBERNATION|SLEEP|WINTER|BEAR|LONG|CAVE
CAMOUFLAGE|HIDE|BLEND|COLORS|ANIMAL|SPOT
BIRD SONG|SING|MORNING|TREES|CALL|TWEET
ROCK POOL|BEACH|CRAB|TIDE|SHALLOW|WATER
SUNRISE|MORNING|EAST|SKY|EARLY|LIGHT
TIME ZONE|HOURS|CLOCK|COUNTRY|DIFFERENCE|TRAVEL
` },
      { id: "modern", name: "Modern Life", raw: `
WIFI|INTERNET|PASSWORD|SIGNAL|ROUTER|CONNECT
PODCAST|LISTEN|EPISODE|AUDIO|HOST|DOWNLOAD
EMOJI|FACE|TEXT|SMILE|ICON|YELLOW
SELFIE|PHOTO|PHONE|FRONT|YOURSELF|STICK
HASHTAG|SYMBOL|SOCIAL|TREND|POST|TAG
STREAMING|WATCH|ONLINE|NETFLIX|BUFFER|SERVICE
CHARGER|PHONE|CABLE|PLUG|BATTERY|POWER
NOTIFICATION|PHONE|POP|ALERT|BADGE|BUZZ
AUTOCORRECT|TYPE|WRONG|PHONE|CHANGE|SPELLING
GROUP CHAT|MESSAGE|FRIENDS|PHONE|MUTE|TYPING
SCREENSHOT|CAPTURE|SCREEN|PHONE|SAVE|IMAGE
BATTERY|PERCENT|LOW|CHARGE|DEAD|PHONE
AIRPLANE MODE|PHONE|OFF|FLIGHT|SIGNAL|TOGGLE
BLUETOOTH|WIRELESS|PAIR|CONNECT|HEADPHONES|DEVICE
DOWNLOAD|FILE|INTERNET|SAVE|BAR|SPEED
UPLOAD|SEND|INTERNET|FILE|CLOUD|SHARE
PASSWORD|SECRET|LOGIN|FORGET|CHARACTERS|RESET
SPAM|EMAIL|JUNK|UNWANTED|FOLDER|DELETE
FIREWALL|SECURITY|BLOCK|NETWORK|PROTECT|COMPUTER
ALGORITHM|FEED|SHOWS|COMPUTER|RECOMMEND|STEPS
SMART SPEAKER|VOICE|ASK|MUSIC|LISTEN|HOME
DRONE|FLY|CAMERA|REMOTE|PROPELLERS|SKY
TREADMILL|RUN|GYM|BELT|MACHINE|WALK
STEP COUNT|WALK|WATCH|DAILY|TARGET|FITNESS
DELIVERY APP|FOOD|ORDER|DRIVER|PHONE|TRACK
RIDESHARE|CAR|APP|DRIVER|PICK|FARE
ELECTRIC CAR|BATTERY|CHARGE|PETROL|QUIET|PLUG
SELF CHECKOUT|SCAN|SHOP|MACHINE|BAG|ITEM
QR CODE|SCAN|SQUARE|PHONE|CAMERA|LINK
CONTACTLESS|TAP|CARD|PAY|LIMIT|WIRELESS
CRYPTOCURRENCY|BITCOIN|DIGITAL|MONEY|MINE|WALLET
INFLUENCER|SOCIAL|FOLLOWERS|BRAND|POST|SPONSOR
UNBOXING|OPEN|VIDEO|PRODUCT|BOX|REVIEW
CLICKBAIT|TITLE|TRICK|CLICK|HEADLINE|SHOCKING
DOOMSCROLL|PHONE|BAD|NEWS|SCROLL|ENDLESS
VIDEO CALL|SCREEN|FACE|MUTE|CAMERA|ZOOM
SCREEN TIME|PHONE|HOURS|REPORT|LIMIT|DAILY
WORKING FROM HOME|OFFICE|REMOTE|LAPTOP|PAJAMAS|COMMUTE
INBOX ZERO|EMAIL|EMPTY|CLEAR|GOAL|UNREAD
OUT OF OFFICE|AWAY|EMAIL|REPLY|HOLIDAY|AUTOMATIC
DEADLINE|TIME|FINISH|DUE|STRESS|DATE
PLAYLIST|SONGS|LIST|SHUFFLE|MAKE|MUSIC
SHUFFLE|RANDOM|ORDER|SONGS|MIX|BUTTON
SUBSCRIPTION|MONTHLY|PAY|CANCEL|SERVICE|RENEW
FREE TRIAL|DAYS|NO|PAY|CANCEL|SIGN
` }
    ];

    const cardsOf = deck => deck.raw.trim().split("\n").map(line => {
      const parts = line.split("|");
      return { word: parts[0], forbidden: parts.slice(1), deck: deck.id };
    });
    for (const deck of DECKS) deck.cards = cardsOf(deck);

    /* ================================================================ *
     * CREATOR TUNING
     * Every knob is declared in plethora.json. ctx.tune hands back safe
     * normalised values for declared knobs and undefined for anything
     * else, so each read carries the same default the manifest does.
     * ================================================================ */
    const tune = ctx.tune || {};
    const tChoice = (id, fb) => (tune.choice ? tune.choice(id) : undefined) ?? fb;
    const tInt = (id, fb) => (tune.integer ? tune.integer(id) : undefined) ?? fb;
    const tBool = (id, fb) => (tune.boolean ? tune.boolean(id) : undefined) ?? fb;
    const tColor = (id, fb) => (tune.color ? tune.color(id) : undefined) ?? fb;

    const TEAM_COLOR = [
      tColor("team_one_color", "#ff5b4a"),
      tColor("team_two_color", "#2fb8e6"),
      tColor("team_three_color", "#ffb020"),
      tColor("team_four_color", "#b07bff")
    ];
    const TEAM_NAMES = ["Team One", "Team Two", "Team Three", "Team Four"];
    const MAX_TEAMS = 4;
    const MAX_ROSTER = 40;   // a big room, with headroom over the twenty
    const PENALTY_TABOO = tInt("taboo_penalty", -1);
    const PENALTY_SKIP = tInt("skip_penalty", 0);
    const WARN_AT = tInt("warn_seconds", 10);

    const SECONDS_OPTIONS = [30, 45, 60, 90];
    const TEAM_OPTIONS = [2, 3, 4];
    const SKIP_OPTIONS = [0, 1, 2, 3, Infinity];
    const skipLabel = n => (n === Infinity ? "∞" : String(n));

    /* ================================================================ *
     * LOOK
     * ================================================================ */
    const INK = "#f4efe6";
    const BG = "#14110f";
    const HOT = "#ffcf3d";
    const GOOD = "#49c97a";
    const BAD = "#ff4d4d";

    const CSS = `
.ff{position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden;
  box-sizing:border-box;background:${BG};color:${INK};
  font-family:ui-rounded,"SF Pro Rounded",system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;
  padding:var(--sat) var(--sar) var(--sab) var(--sal)}
.ff *{box-sizing:border-box}
.ff-scr{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;padding:12px 14px 14px;--team:#8a8076}
.ff-scroll{overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:18px;
  -webkit-mask-image:linear-gradient(#000 calc(100% - 16px),transparent);
  mask-image:linear-gradient(#000 calc(100% - 16px),transparent)}
.ff-t{font-weight:800;letter-spacing:.14em;text-transform:uppercase;font-size:11px;color:#a49a8c}
.ff-h1{font-weight:800;letter-spacing:.02em;text-transform:uppercase;line-height:.94;margin:0}
.ff-sub{color:#a49a8c;font-size:13px;line-height:1.38;margin:0}

.ff-btn{appearance:none;border:0;width:100%;min-height:54px;border-radius:16px;
  font:inherit;font-weight:800;letter-spacing:.1em;text-transform:uppercase;font-size:15px;
  background:#272220;color:${INK};cursor:pointer;display:flex;align-items:center;
  justify-content:center;gap:8px;padding:10px 12px;transition:transform .07s ease,filter .12s ease}
.ff-btn:active{transform:scale(.975);filter:brightness(1.15)}
.ff-btn[disabled]{opacity:.34;pointer-events:none}
.ff-btn.go{background:${GOOD};color:#07250f}
.ff-btn.buzz{background:${BAD};color:#2a0000}
.ff-btn.skip{background:#3a3330}
.ff-btn.big{min-height:64px;font-size:18px;letter-spacing:.14em}
.ff-btn.ghost{background:transparent;box-shadow:inset 0 0 0 2px #35302c;color:#c9c0b4;min-height:46px;font-size:13px}

.ff-chips{display:flex;flex-wrap:wrap;gap:8px}
.ff-chip{appearance:none;border:0;font:inherit;font-weight:700;font-size:14px;letter-spacing:.04em;
  padding:11px 14px;min-height:44px;border-radius:12px;background:#241f1d;color:#bab0a3;cursor:pointer}
.ff-chip.on{background:${INK};color:#14110f}
.ff-chip:active{transform:scale(.96)}

.ff-row{display:flex;gap:10px}
.ff-row>*{flex:1}
.ff-field{display:flex;flex-direction:column;gap:7px}
.ff-name{appearance:none;width:100%;border:0;border-radius:14px;padding:13px 14px;min-height:50px;
  font:inherit;font-weight:800;font-size:17px;letter-spacing:.02em;background:#241f1d;color:${INK}}
.ff-name:focus{outline:2px solid var(--team);outline-offset:1px}
.ff-dot{width:12px;height:12px;border-radius:99px;display:inline-block;flex:none}

/* ---- the card ---- */
.ff-card{flex:1;min-height:0;display:flex;flex-direction:column;border-radius:22px;overflow:hidden;
  background:#fbf6ec;box-shadow:0 16px 38px rgba(0,0,0,.5)}
.ff-head{background:var(--team);color:#fff;padding:18px 14px;text-align:center;flex:none}
.ff-word{font-weight:800;text-transform:uppercase;letter-spacing:.01em;line-height:1.02;
  text-shadow:0 2px 0 rgba(0,0,0,.14);word-break:break-word}
.ff-forb{flex:1;min-height:0;margin:0;padding:10px 0;list-style:none;display:flex;flex-direction:column;justify-content:center}
.ff-forb li{text-align:center;text-transform:uppercase;font-weight:700;letter-spacing:.09em;
  color:#302a25;padding:8px 12px;border-top:1px solid rgba(0,0,0,.1);
  font-size:clamp(13px,4.2vw,19px);overflow-wrap:anywhere}
.ff-forb li:first-child{border-top:none}

/* ---- the clock ---- */
.ff-clock{display:flex;align-items:center;justify-content:space-between;gap:10px;flex:none}
.ff-secs{font-variant-numeric:tabular-nums;font-weight:800;font-size:32px;line-height:1;letter-spacing:-.02em}
.ff-bar{height:8px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden;flex:none}
.ff-bar i{display:block;height:100%;width:100%;background:var(--team);transform-origin:left center}
.ff-warn .ff-secs{color:${HOT}}
.ff-warn .ff-bar i{background:${HOT}}
.ff-pill.up{color:${GOOD}}
.ff-pill.down{color:${BAD}}
.ff-pill{font-weight:800;font-size:12px;letter-spacing:.1em;text-transform:uppercase;
  padding:7px 11px;border-radius:99px;background:#241f1d;color:#bab0a3;display:flex;align-items:center;gap:7px}

/* ---- handoff ---- */
.ff-pass{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:14px;text-align:center;border-radius:22px;padding:24px 18px;background:var(--team);color:#fff}
.ff-pass .ff-sub{color:rgba(255,255,255,.85)}
.ff-pass.hug{flex:1;max-height:44vh}
.ff-gap{flex:1;min-height:0}

/* ---- results ---- */
.ff-log{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.ff-log li{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;
  background:#1e1a18;font-weight:700;font-size:15px;letter-spacing:.02em;text-transform:uppercase}
.ff-log .m{width:22px;flex:none;text-align:center;font-size:16px;font-weight:800}
.ff-log .got .m{color:${GOOD}}
.ff-log .tab .m{color:${BAD}}
.ff-log .skp .m{color:#8a8076}
.ff-log .w{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ff-log .v{color:#8a8076;font-variant-numeric:tabular-nums}

.ff-board{display:flex;gap:10px;flex:none}
.ff-board.wide{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ff-board.wide .ff-team{padding:9px 11px}
.ff-board.wide .ff-team s{font-size:24px}

.ff-ply{display:inline-flex;align-items:stretch;border-radius:12px;overflow:hidden;background:#241f1d}
.ff-ply button{appearance:none;border:0;font:inherit;font-weight:700;font-size:14px;
  background:transparent;color:#e6ddcf;cursor:pointer;min-height:44px;padding:0 12px}
.ff-ply button[data-move]{border-left:4px solid var(--c);padding-left:10px}
.ff-ply button[data-drop]{color:#8a8076;font-size:19px;padding:0 12px;
  box-shadow:inset 1px 0 0 rgba(255,255,255,.07)}
.ff-ply button:active{background:rgba(255,255,255,.08)}
.ff-team{flex:1;border-radius:16px;padding:12px 14px;background:#1e1a18;display:flex;
  flex-direction:column;gap:3px;box-shadow:inset 0 0 0 2px transparent}
.ff-team.lead{box-shadow:inset 0 0 0 2px var(--c)}
.ff-team b{font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:var(--c);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ff-team s{text-decoration:none;font-size:30px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums}

.ff-foot{flex:none;display:flex;flex-direction:column;gap:9px}
.ff-note{text-align:center;font-size:12px;color:#8a8076;letter-spacing:.04em}
.ff-flash{position:absolute;inset:0;pointer-events:none;opacity:0;
  background:radial-gradient(118% 78% at 50% 50%,transparent 38%,var(--flash) 100%)}
.ff-flash.on{animation:ffFlash .26s ease-out}
@keyframes ffFlash{0%{opacity:.62}100%{opacity:0}}
@media (max-height:560px){
  .ff-scr{gap:7px;padding:8px 12px 10px}
  .ff-head{padding:9px 12px}
  .ff-forb{padding:2px 0}
  .ff-forb li{padding:4px 10px;font-size:clamp(12px,2.9vh,17px);letter-spacing:.06em}
  .ff-btn{min-height:44px;font-size:13px}
  .ff-btn.big{min-height:50px;font-size:15px}
  .ff-secs{font-size:26px}
  .ff-bar{height:6px}
  .ff-pass{padding:14px;gap:8px}
  .ff-team s{font-size:24px}
  .ff-foot{gap:7px}
}
@media (prefers-reduced-motion:reduce){.ff-flash.on{animation:none}.ff-btn:active{transform:none}}
`;

    /* ================================================================ *
     * SOUND BOARD
     * A party game is half noise, and none of it can be shipped as a
     * file, so every cue is synthesised. The buzzer is the important
     * one: it has to cut across a room mid-argument.
     * ================================================================ */
    const sfx = (() => {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC || !ctx.capabilities.audio) return { unlock() {}, got() {}, buzz() {}, skip() {}, tick() {}, timeUp() {}, fanfare() {} };
      let ac = null;

      function ready() {
        if (!ac) {
          try { ac = new AC(); } catch (e) { return null; }
          ctx.onDestroy(() => { try { ac.close(); } catch (e) {} });
        }
        if (ac.state === "suspended") ac.resume().catch(() => {});
        return ac;
      }

      // One voice: an oscillator through its own gain envelope. Everything
      // below is a handful of these stacked up.
      function voice(freq, startAt, dur, type, peak, endFreq) {
        const a = ready();
        if (!a || !enabled()) return;
        const t0 = a.currentTime + startAt;
        const osc = a.createOscillator();
        const gain = a.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.012, dur * 0.3));
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain).connect(a.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      }

      const enabled = () => S.cfg.sound;

      return {
        // Autoplay policy: the context has to be opened inside a gesture.
        unlock() { ready(); },
        got() { voice(784, 0, 0.09, "triangle", 0.26); voice(1175, 0.075, 0.13, "triangle", 0.24); },
        skip() { voice(420, 0, 0.11, "sine", 0.16, 250); },
        tick() { voice(1500, 0, 0.028, "square", 0.075); },
        // Two detuned squares an augmented fourth apart: the classic
        // game-show honk, unpleasant on purpose.
        buzz() { voice(146, 0, 0.42, "square", 0.2); voice(97, 0.01, 0.44, "square", 0.17); },
        timeUp() { voice(120, 0, 0.85, "square", 0.22); voice(82, 0.02, 0.9, "square", 0.18); },
        fanfare() { [523, 659, 784, 1047].forEach((f, i) => voice(f, i * 0.11, 0.3, "triangle", 0.22)); }
      };
    })();

    function haptic(kind) {
      if (S.cfg.haptics && ctx.capabilities.haptics) ctx.platform.haptic(kind);
    }

    /* ================================================================ *
     * STATE
     * ================================================================ */
    const S = {
      screen: "setup",
      cfg: {
        seconds: Number(tChoice("default_seconds", "60")) || 60,
        skips: (() => { const v = tChoice("default_skips", "2"); return v === "unlimited" ? Infinity : Number(v); })(),
        turnsEach: tInt("default_turns", 4),
        teamCount: Number(tChoice("default_teams", "2")) || 2,
        decks: new Set(["classic"]),
        sound: tBool("sound_default", true),
        haptics: tBool("haptics_default", true)
      },
      teams: [],
      // Naming the room is optional. With names in, the phone calls out who
      // is up and works round every team so one person cannot hog the cards.
      roster: [],
      focusAdd: false,
      active: 0,
      pool: [],
      poolAt: 0,
      turn: null,
      bestTurn: 0,
      tiebreak: false,
      extraTurns: 0,
      started: false,
      // The highest single turn already written to the leaderboard this
      // session, so a tiebreak that beats it still gets recorded.
      submittedValue: 0
    };

    const turnTarget = () => S.cfg.turnsEach + S.extraTurns;

    /* ================================================================ *
     * TEAMS AND THE ROOM
     * ================================================================ */
    const makeTeam = i => ({ name: TEAM_NAMES[i], color: TEAM_COLOR[i], score: 0, taken: 0, giverAt: 0 });

    const membersOf = i => S.roster.filter(p => p.team === i);

    function smallestTeam() {
      let best = 0;
      for (let i = 1; i < S.teams.length; i++) {
        if (membersOf(i).length < membersOf(best).length) best = i;
      }
      return best;
    }

    function setTeamCount(want) {
      const n = Math.max(2, Math.min(MAX_TEAMS, want));
      while (S.teams.length < n) S.teams.push(makeTeam(S.teams.length));
      if (S.teams.length > n) {
        S.teams.length = n;
        // Anyone stranded on a team that just disappeared rejoins the
        // thinnest one left rather than vanishing from the room.
        S.roster.forEach(pl => { if (pl.team >= n) pl.team = smallestTeam(); });
      }
      S.cfg.teamCount = n;
    }

    function addPlayer(raw) {
      const name = String(raw || "").trim().replace(/\s+/g, " ").slice(0, 16);
      if (!name || S.roster.length >= MAX_ROSTER) return false;
      S.roster.push({ name, team: smallestTeam() });
      return true;
    }

    // Reshuffle the whole room and deal it round-robin, so the teams are
    // not just whoever typed their name first.
    function dealRoster() {
      shuffle(S.roster);
      S.roster.forEach((pl, i) => { pl.team = i % S.teams.length; });
    }

    // Whose turn it is to give clues for a team: straight round-robin
    // through that team's list, so everybody gets the phone in order.
    function giverFor(i) {
      const list = membersOf(i);
      if (!list.length) return null;
      return list[S.teams[i].giverAt % list.length];
    }

    setTeamCount(S.cfg.teamCount);

    // The primary track is the single number worth carrying off the table:
    // the most words one clue-giver landed in one turn.
    const bestTrack = ctx.game && ctx.game.score
      ? ctx.game.score({ initial: 0, min: 0 })
      : null;

    /* ================================================================ *
     * DECK POOL
     * Cards are dealt off one shuffled pile spanning every chosen deck,
     * so a card cannot come round twice until the pile is exhausted.
     * ================================================================ */
    function shuffle(list) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = list[i]; list[i] = list[j]; list[j] = t;
      }
      return list;
    }

    function buildPool() {
      const picked = DECKS.filter(d => S.cfg.decks.has(d.id));
      const use = picked.length ? picked : [DECKS[0]];
      S.pool = shuffle(use.reduce((all, d) => all.concat(d.cards), []));
      S.poolAt = 0;
    }

    function dealCard() {
      if (S.poolAt >= S.pool.length) { shuffle(S.pool); S.poolAt = 0; }
      return S.pool[S.poolAt++];
    }

    /* ================================================================ *
     * SETTINGS THAT OUTLIVE THE SESSION
     * ================================================================ */
    const SAVE_KEY = "forbidden-five/v1";

    async function loadSaved() {
      if (!ctx.capabilities.storage) return;
      let saved = null;
      try { saved = await ctx.storage.get(SAVE_KEY); } catch (e) { return; }
      if (!saved || typeof saved !== "object") return;
      if (Number.isFinite(saved.teamCount)) setTeamCount(saved.teamCount);
      if (Array.isArray(saved.names)) {
        saved.names.forEach((n, i) => { if (S.teams[i] && typeof n === "string" && n.trim()) S.teams[i].name = n.slice(0, 18); });
      }
      if (Array.isArray(saved.roster)) {
        S.roster = saved.roster
          .filter(pl => pl && typeof pl.name === "string" && pl.name.trim())
          .slice(0, MAX_ROSTER)
          .map(pl => ({
            name: pl.name.slice(0, 16),
            // A roster saved against more teams than are set now has to land
            // somewhere real, so out-of-range players join the first team.
            team: Number.isInteger(pl.team) && pl.team >= 0 && pl.team < S.teams.length ? pl.team : 0
          }));
      }
      if (SECONDS_OPTIONS.indexOf(saved.seconds) >= 0) S.cfg.seconds = saved.seconds;
      if (saved.skips === "unlimited") S.cfg.skips = Infinity;
      else if (SKIP_OPTIONS.indexOf(saved.skips) >= 0) S.cfg.skips = saved.skips;
      if (Number.isFinite(saved.turnsEach) && saved.turnsEach >= 2 && saved.turnsEach <= 12) S.cfg.turnsEach = saved.turnsEach;
      if (Array.isArray(saved.decks)) {
        const valid = saved.decks.filter(id => DECKS.some(d => d.id === id));
        if (valid.length) S.cfg.decks = new Set(valid);
      }
      if (typeof saved.sound === "boolean") S.cfg.sound = saved.sound;
      if (typeof saved.haptics === "boolean") S.cfg.haptics = saved.haptics;
    }

    function saveSettings() {
      if (!ctx.capabilities.storage) return;
      ctx.storage.set(SAVE_KEY, {
        names: S.teams.map(t => t.name),
        teamCount: S.teams.length,
        roster: S.roster.map(pl => ({ name: pl.name, team: pl.team })),
        seconds: S.cfg.seconds,
        skips: S.cfg.skips === Infinity ? "unlimited" : S.cfg.skips,
        turnsEach: S.cfg.turnsEach,
        decks: Array.from(S.cfg.decks),
        sound: S.cfg.sound,
        haptics: S.cfg.haptics
      }).catch(() => {});
    }

    /* ================================================================ *
     * DOM PLUMBING
     * ================================================================ */
    // Everything lives inside the one root Plethora hands back: the
    // stylesheet, the screen the bit repaints, and the hit-flash overlay.
    // Nothing is ever queried or mounted outside it.
    const root = ctx.createRoot({ className: "ff" });
    root.innerHTML = `<style>${CSS}</style><div class="ff-scr"></div><div class="ff-flash"></div>`;
    const stage = root.querySelector(".ff-scr");
    const flash = root.querySelector(".ff-flash");

    function applySafeArea() {
      const sa = ctx.safeArea || {};
      root.style.setProperty("--sat", (sa.top || 0) + "px");
      root.style.setProperty("--sar", (sa.right || 0) + "px");
      // The bottom inset is where the host's own chrome lives, so the
      // busiest buttons in the bit get pushed clear of it by a margin.
      root.style.setProperty("--sab", ((sa.bottom || 0) + 8) + "px");
      root.style.setProperty("--sal", (sa.left || 0) + "px");
    }
    applySafeArea();

    const esc = s => String(s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    // Prefer the SDK's activation helper: it covers click plus keyboard
    // for DOM controls and hands cleanup back to ctx.
    function onTap(el, fn) {
      if (!el) return;
      if (ctx.input && ctx.input.activate) ctx.input.activate(el, fn);
      else ctx.listen(el, "click", fn);
    }

    function bind(selector, fn) {
      stage.querySelectorAll(selector).forEach(el => onTap(el, () => fn(el)));
    }

    function screenFlash(color) {
      flash.style.setProperty("--flash", color);
      flash.classList.remove("on");
      void flash.offsetWidth;   // restart the animation
      flash.classList.add("on");
    }

    /* ================================================================ *
     * SCREENS
     * Each one returns markup; mount() swaps it in and rewires the taps.
     * ================================================================ */
    const TURN_OPTIONS = (() => {
      const set = new Set([2, 3, 4, 5, 6, 8, 10, 12]);
      set.add(Math.min(12, Math.max(2, S.cfg.turnsEach)));
      return Array.from(set).sort((a, b) => a - b);
    })();

    // The head band is fixed height, so the longest cards have to give way
    // on point size rather than push the forbidden list off the card.
    function wordSize(word) {
      const n = word.length;
      if (n <= 6) return 44;
      if (n <= 9) return 38;
      if (n <= 12) return 31;
      if (n <= 16) return 25;
      return 21;
    }

    function teamBoard() {
      const top = S.teams.reduce((m, t) => Math.max(m, t.score), -Infinity);
      // Nobody is outlined while the top is shared, or every team would be.
      const sole = S.teams.filter(t => t.score === top).length === 1;
      return `<div class="ff-board${S.teams.length > 2 ? " wide" : ""}">` + S.teams.map(t =>
        `<div class="ff-team${sole && t.score === top ? " lead" : ""}" style="--c:${t.color}">
           <b>${esc(t.name)}</b><s>${t.score}</s></div>`).join("") + `</div>`;
    }

    // A line of honest advice about whether the room actually fits the rules
    // it has chosen: twenty people and four turns means most never play.
    function rosterHint() {
      if (!S.roster.length) return "Optional. Add names and the phone calls out whose turn it is to give clues.";
      const biggest = S.teams.reduce((m, t, i) => Math.max(m, membersOf(i).length), 0);
      const empty = S.teams.filter((t, i) => !membersOf(i).length).length;
      if (empty) return `${empty} team${empty === 1 ? " has" : "s have"} nobody in it \u2014 shuffle, or move players across.`;
      if (S.cfg.turnsEach >= biggest) return `${S.roster.length} players. Everyone gives clues at least once.`;
      return `${S.roster.length} players, up to ${biggest} a team \u2014 only ${S.cfg.turnsEach} of them get to give clues. Raise turns each for a full round.`;
    }

    function setupScreen() {
      const teamChips = TEAM_OPTIONS.map(t =>
        `<button class="ff-chip${S.teams.length === t ? " on" : ""}" data-teamcount="${t}">${t}</button>`).join("");
      // Players are listed under the team they are on, and tapping a name
      // walks them to the next team.
      const rosterLists = S.teams.map((t, i) => {
        const mine = S.roster.map((pl, idx) => ({ pl, idx })).filter(e => e.pl.team === i);
        if (!mine.length && !S.roster.length) return "";
        return `<div style="display:flex;flex-direction:column;gap:6px">
          <span class="ff-t" style="color:${t.color}">${esc(t.name)} &middot; ${mine.length}</span>
          <div class="ff-chips">${mine.map(e =>
            `<span class="ff-ply" style="--c:${t.color}">
               <button data-move="${e.idx}" aria-label="Move ${esc(e.pl.name)} to the next team">${esc(e.pl.name)}</button>
               <button data-drop="${e.idx}" aria-label="Remove ${esc(e.pl.name)}">&times;</button>
             </span>`).join("") || `<span class="ff-note" style="text-align:left">nobody yet</span>`}</div>
        </div>`;
      }).join("");
      const deckChips = DECKS.map(d =>
        `<button class="ff-chip${S.cfg.decks.has(d.id) ? " on" : ""}" data-deck="${d.id}">${esc(d.name)}</button>`).join("");
      const secChips = SECONDS_OPTIONS.map(s =>
        `<button class="ff-chip${S.cfg.seconds === s ? " on" : ""}" data-sec="${s}">${s}s</button>`).join("");
      const skipChips = SKIP_OPTIONS.map(s =>
        `<button class="ff-chip${S.cfg.skips === s ? " on" : ""}" data-skips="${s}">${skipLabel(s)}</button>`).join("");
      const turnChips = TURN_OPTIONS.map(s =>
        `<button class="ff-chip${S.cfg.turnsEach === s ? " on" : ""}" data-turns="${s}">${s}</button>`).join("");
      const cardCount = DECKS.filter(d => S.cfg.decks.has(d.id)).reduce((n, d) => n + d.cards.length, 0);

      return `
<div class="ff-scroll" style="flex:1;min-height:0;display:flex;flex-direction:column;gap:13px">
  <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:10px">
    <div>
      <p class="ff-t">Pass-and-play party game</p>
      <h1 class="ff-h1" style="font-size:27px">Forbidden Five</h1>
    </div>
    <button class="ff-chip" data-rules style="flex:none;padding:10px 12px;font-size:13px">Rules</button>
  </div>

  <div class="ff-field">
    <span class="ff-t">Teams</span>
    <div class="ff-chips">${teamChips}</div>
    ${S.teams.map((t, i) => `
      <div style="display:flex;align-items:center;gap:10px">
        <span class="ff-dot" style="background:${t.color}"></span>
        <input class="ff-name" style="--team:${t.color}" data-team="${i}"
               value="${esc(t.name)}" maxlength="18" autocomplete="off"
               spellcheck="false" aria-label="Team ${i + 1} name">
      </div>`).join("")}
  </div>

  <div class="ff-field">
    <span class="ff-t">Players${S.roster.length ? " &middot; " + S.roster.length : ""}</span>
    <div style="display:flex;gap:8px">
      <input class="ff-name" data-newplayer placeholder="Add a name" maxlength="16"
             autocomplete="off" spellcheck="false" aria-label="Add a player"
             style="flex:1;min-width:0;font-size:15px">
      <button class="ff-chip" data-add style="flex:none">Add</button>
    </div>
    ${rosterLists}
    ${S.roster.length ? `<div class="ff-chips">
      <button class="ff-chip" data-deal>Shuffle teams</button>
      <button class="ff-chip" data-clearroster>Clear all</button>
    </div>` : ""}
    <p class="ff-note" style="text-align:left">${rosterHint()}</p>
  </div>

  <div class="ff-field">
    <span class="ff-t">Decks &middot; ${cardCount} cards</span>
    <div class="ff-chips">${deckChips}</div>
  </div>

  <div class="ff-field">
    <span class="ff-t">Seconds a turn</span>
    <div class="ff-chips">${secChips}</div>
  </div>

  <div class="ff-field">
    <span class="ff-t">Skips a turn</span>
    <div class="ff-chips">${skipChips}</div>
  </div>

  <div class="ff-field">
    <span class="ff-t">Turns each team gets</span>
    <div class="ff-chips">${turnChips}</div>
  </div>

  <div class="ff-field">
    <span class="ff-t">Handset</span>
    <div class="ff-chips">
      <button class="ff-chip${S.cfg.sound ? " on" : ""}" data-toggle="sound">Sound</button>
      <button class="ff-chip${S.cfg.haptics ? " on" : ""}" data-toggle="haptics">Vibrate</button>
    </div>
  </div>
</div>

<div class="ff-foot">
  <button class="ff-btn go big" data-go>Start the match</button>
</div>`;
    }

    function passScreen() {
      const t = S.teams[S.active];
      const g = giverFor(S.active);
      const n = S.tiebreak ? "Tiebreak" : `Turn ${t.taken + 1} of ${turnTarget()}`;
      return `
${teamBoard()}
<div class="ff-pass" style="--team:${t.color}">
  <p class="ff-t" style="color:rgba(255,255,255,.82)">${n}</p>
  <h1 class="ff-h1" style="font-size:${g ? 24 : 32}px">${esc(t.name)}</h1>
  ${g ? `<h1 class="ff-h1" style="font-size:38px">${esc(g.name)}</h1>` : ""}
  <p class="ff-sub">${g ? `Hand the phone to ${esc(g.name)}.` : "Hand the phone to your clue-giver."}<br>Everyone else on the team, eyes off the screen.</p>
</div>
<div class="ff-foot">
  <button class="ff-btn go big" data-ready>Start my turn</button>
  <p class="ff-note">${S.teams.length > 2 ? "Other teams" : "Other team"}: watch the screen and hit TABOO on a slip.</p>
</div>`;
    }

    function playScreen() {
      const t = S.teams[S.active];
      const c = S.turn.card;
      const skips = S.turn.skipsLeft === Infinity ? "∞" : S.turn.skipsLeft;
      return `
<div class="ff-clock">
  <div class="ff-pill"><span class="ff-dot" style="background:${t.color}"></span>${esc(t.name)}</div>
  <div class="ff-pill${S.turn.points > 0 ? " up" : S.turn.points < 0 ? " down" : ""}" data-tally>${S.turn.points >= 0 ? "+" : ""}${S.turn.points}</div>
  <div class="ff-secs" data-secs>${Math.ceil(S.turn.msLeft / 1000)}</div>
</div>
<div class="ff-bar"><i data-fill></i></div>
<div class="ff-card" style="--team:${t.color}">
  <div class="ff-head"><div class="ff-word" style="font-size:min(${wordSize(c.word)}px,8.6vh)">${esc(c.word)}</div></div>
  <ul class="ff-forb">${c.forbidden.map(w => `<li>${esc(w)}</li>`).join("")}</ul>
</div>
<div class="ff-foot">
  <div class="ff-row">
    <button class="ff-btn buzz" data-taboo>Taboo</button>
    <button class="ff-btn skip" data-skip ${S.turn.skipsLeft <= 0 ? "disabled" : ""}>Skip &middot; ${skips}</button>
  </div>
  <button class="ff-btn go big" data-got>Got it</button>
</div>`;
    }

    const MARK = { got: "✓", taboo: "✕", skip: "↷" };
    const CLS = { got: "got", taboo: "tab", skip: "skp" };

    function turnEndScreen() {
      const t = S.teams[S.active];
      const log = S.turn.log.length
        ? `<ul class="ff-log">${S.turn.log.map(e =>
            `<li class="${CLS[e.kind]}"><span class="m">${MARK[e.kind]}</span>
             <span class="w">${esc(e.word)}</span><span class="v">${e.delta > 0 ? "+" : ""}${e.delta}</span></li>`).join("")}</ul>`
        : `<p class="ff-sub">No cards played. Brutal.</p>`;
      const got = S.turn.log.filter(e => e.kind === "got").length;
      return `
<div>
  <p class="ff-t">${S.turn.giver ? esc(S.turn.giver) + " &middot; " : ""}Time &mdash; ${got} word${got === 1 ? "" : "s"} landed</p>
  <h1 class="ff-h1" style="font-size:28px">${esc(t.name)} scored ${S.turn.points >= 0 ? "+" : ""}${S.turn.points}</h1>
</div>
${teamBoard()}
<div class="ff-scroll" style="flex:1;min-height:0">${log}</div>
<div class="ff-foot">
  <button class="ff-btn go big" data-next>${S.gameOverNext ? "See the result" : "Next team"}</button>
</div>`;
    }

    function overScreen() {
      const ranked = S.teams.slice().sort((x, y) => y.score - x.score);
      const top = ranked[0].score;
      const leaders = S.teams.filter(t => t.score === top);
      const draw = leaders.length > 1;
      const head = !draw ? `${leaders[0].name} wins`
        : leaders.length === S.teams.length ? "It's a draw"
        : `${leaders.map(t => t.name).join(" and ")} tie`;
      const color = draw ? "#6b625a" : leaders[0].color;
      const pb = S.personalBest ? `<p class="ff-note" style="color:${HOT}">New personal best</p>` : "";
      return `
<div class="ff-pass hug" style="--team:${color}">
  <p class="ff-t" style="color:rgba(255,255,255,.82)">Full time</p>
  <h1 class="ff-h1" style="font-size:${head.length > 22 ? 24 : 30}px">${esc(head)}</h1>
  <p class="ff-sub" style="font-size:26px;font-weight:800;color:#fff">${ranked.map(t => t.score).join(" &ndash; ")}</p>
</div>
${teamBoard()}
<p class="ff-note">Best turn of the match: ${S.bestTurn} word${S.bestTurn === 1 ? "" : "s"} in ${S.cfg.seconds}s</p>
${pb}
<div class="ff-gap"></div>
<div class="ff-foot">
  ${draw ? `<button class="ff-btn go big" data-tiebreak>Play a tiebreak turn</button>` : ""}
  <button class="ff-btn ${draw ? "ghost" : "go big"}" data-again>Play again</button>
  <button class="ff-btn ghost" data-setup>Change teams &amp; rules</button>
</div>`;
    }

    /* ================================================================ *
     * MOUNTING AND WIRING
     * ================================================================ */
    let secsNode = null, fillNode = null, tallyNode = null;

    function mount() {
      secsNode = fillNode = tallyNode = null;
      stage.classList.remove("ff-warn");
      stage.scrollTop = 0;

      const live = S.screen === "pass" || S.screen === "play" || S.screen === "turnEnd";
      stage.style.setProperty("--team", live ? S.teams[S.active].color : "#8a8076");

      if (S.screen === "setup") stage.innerHTML = setupScreen();
      else if (S.screen === "pass") stage.innerHTML = passScreen();
      else if (S.screen === "play") stage.innerHTML = playScreen();
      else if (S.screen === "turnEnd") stage.innerHTML = turnEndScreen();
      else stage.innerHTML = overScreen();

      if (S.screen === "setup") wireSetup();
      else if (S.screen === "pass") bind("[data-ready]", startTurn);
      else if (S.screen === "play") wirePlay();
      else if (S.screen === "turnEnd") bind("[data-next]", afterTurn);
      else wireOver();
    }

    function wireSetup() {
      stage.querySelectorAll("[data-team]").forEach(el => {
        ctx.listen(el, "input", () => {
          const i = Number(el.getAttribute("data-team"));
          S.teams[i].name = el.value.slice(0, 18);
          saveSettings();
        });
      });
      bind("[data-sec]", el => { S.cfg.seconds = Number(el.getAttribute("data-sec")); saveSettings(); mount(); });
      bind("[data-skips]", el => {
        const v = el.getAttribute("data-skips");
        S.cfg.skips = v === "Infinity" ? Infinity : Number(v);
        saveSettings(); mount();
      });
      bind("[data-turns]", el => { S.cfg.turnsEach = Number(el.getAttribute("data-turns")); saveSettings(); mount(); });
      bind("[data-deck]", el => {
        const id = el.getAttribute("data-deck");
        // A match needs somewhere to deal from, so the last deck standing
        // cannot be switched off.
        if (S.cfg.decks.has(id)) { if (S.cfg.decks.size > 1) S.cfg.decks.delete(id); }
        else S.cfg.decks.add(id);
        saveSettings(); mount();
      });
      bind("[data-toggle]", el => {
        const key = el.getAttribute("data-toggle");
        S.cfg[key] = !S.cfg[key];
        if (key === "haptics" && S.cfg.haptics) haptic("light");
        saveSettings(); mount();
      });
      bind("[data-teamcount]", el => {
        setTeamCount(Number(el.getAttribute("data-teamcount")));
        saveSettings(); mount();
      });

      const addField = stage.querySelector("[data-newplayer]");
      const commitPlayer = () => {
        if (!addField) return;
        if (addPlayer(addField.value)) {
          haptic("light");
          // Twenty names is a lot of typing, so keep the caret where it was.
          S.focusAdd = true;
          saveSettings();
          mount();
        }
      };
      if (addField) {
        ctx.listen(addField, "keydown", e => {
          if (e.key === "Enter") { e.preventDefault(); commitPlayer(); }
        });
      }
      bind("[data-add]", commitPlayer);
      bind("[data-move]", el => {
        const pl = S.roster[Number(el.getAttribute("data-move"))];
        if (pl) { pl.team = (pl.team + 1) % S.teams.length; saveSettings(); mount(); }
      });
      bind("[data-drop]", el => {
        S.roster.splice(Number(el.getAttribute("data-drop")), 1);
        saveSettings(); mount();
      });
      bind("[data-deal]", () => { dealRoster(); haptic("medium"); saveSettings(); mount(); });
      bind("[data-clearroster]", () => { S.roster = []; saveSettings(); mount(); });

      if (S.focusAdd && addField) {
        S.focusAdd = false;
        addField.focus();
      }

      bind("[data-rules]", () => {
        if (ctx.onboarding && ctx.onboarding.replay) ctx.onboarding.replay();
      });
      bind("[data-go]", startMatch);
    }

    function wirePlay() {
      secsNode = stage.querySelector("[data-secs]");
      fillNode = stage.querySelector("[data-fill]");
      tallyNode = stage.querySelector("[data-tally]");
      bind("[data-got]", () => resolve("got"));
      bind("[data-taboo]", () => resolve("taboo"));
      bind("[data-skip]", () => resolve("skip"));
      paintClock();
    }

    function wireOver() {
      bind("[data-again]", () => { startMatch(); });
      bind("[data-setup]", () => { S.screen = "setup"; mount(); });
      bind("[data-tiebreak]", () => {
        // One extra turn each, from the top, until somebody is ahead.
        S.tiebreak = true;
        S.extraTurns += 1;
        S.active = 0;
        S.screen = "pass";
        mount();
      });
    }

    /* ================================================================ *
     * MATCH FLOW
     * ================================================================ */
    function startMatch() {
      ctx.platform.start({ mode: Array.from(S.cfg.decks).join("+") });
      sfx.unlock();
      S.teams.forEach(t => { t.score = 0; t.taken = 0; t.giverAt = 0; });
      S.active = 0;
      S.bestTurn = 0;
      S.tiebreak = false;
      S.extraTurns = 0;
      S.personalBest = false;
      S.gameOverNext = false;
      if (bestTrack) bestTrack.reset();
      buildPool();
      S.started = true;
      S.screen = "pass";
      mount();
      ctx.platform.emit("match_start", {
        seconds: S.cfg.seconds,
        turns: S.cfg.turnsEach,
        teams: S.teams.length,
        players: S.roster.length,
        decks: Array.from(S.cfg.decks)
      });
    }

    function startTurn() {
      sfx.unlock();
      const giver = giverFor(S.active);
      S.turn = {
        giver: giver ? giver.name : null,
        card: dealCard(),
        msLeft: S.cfg.seconds * 1000,
        skipsLeft: S.cfg.skips,
        log: [],
        points: 0,
        running: true,
        lastWholeSecond: -1
      };
      S.screen = "play";
      mount();
      haptic("light");
    }

    // One of the three buttons. Each closes the current card and deals the
    // next one without stopping the clock.
    function resolve(kind) {
      if (!S.turn || !S.turn.running) return;
      if (kind === "skip" && S.turn.skipsLeft <= 0) return;

      const delta = kind === "got" ? 1 : kind === "taboo" ? PENALTY_TABOO : PENALTY_SKIP;
      S.turn.log.push({ kind, word: S.turn.card.word, delta });
      S.turn.points += delta;
      if (kind === "skip" && S.turn.skipsLeft !== Infinity) S.turn.skipsLeft -= 1;

      if (kind === "got") { sfx.got(); haptic("success"); screenFlash(GOOD); }
      else if (kind === "taboo") { sfx.buzz(); haptic("error"); screenFlash(BAD); }
      else { sfx.skip(); haptic("light"); }

      ctx.platform.interact({ type: kind, word: S.turn.card.word, deck: S.turn.card.deck });

      S.turn.card = dealCard();
      mount();
    }

    function endTurn() {
      S.turn.running = false;
      sfx.timeUp();
      haptic("warning");
      screenFlash(HOT);

      const team = S.teams[S.active];
      team.score += S.turn.points;
      team.taken += 1;
      // Move the cursor on, so next time this team is up it is someone else.
      team.giverAt += 1;

      const landed = S.turn.log.filter(e => e.kind === "got").length;
      if (landed > S.bestTurn) S.bestTurn = landed;

      S.gameOverNext = S.teams.every(t => t.taken >= turnTarget());
      S.screen = "turnEnd";
      mount();

      ctx.platform.milestone("turn_end", { team: team.name, giver: S.turn.giver, landed, points: S.turn.points });
    }

    function afterTurn() {
      if (S.gameOverNext) { finishMatch(); return; }
      S.active = (S.active + 1) % S.teams.length;
      S.screen = "pass";
      mount();
    }

    async function finishMatch() {
      S.screen = "over";
      mount();
      sfx.fanfare();
      haptic("success");

      const best = S.teams.reduce((m, t) => Math.max(m, t.score), -Infinity);
      const leaders = S.teams.filter(t => t.score === best);
      const draw = leaders.length > 1;
      const winner = draw ? null : leaders[0];

      ctx.platform.setProgress(1);
      ctx.platform.complete({
        result: draw ? "draw" : "win",
        winner: winner ? winner.name : null,
        teams: S.teams.length,
        players: S.roster.length,
        scores: S.teams.map(t => t.score),
        bestTurn: S.bestTurn
      });

      // One durable record a match, at the result, not per turn.
      if (bestTrack && S.bestTurn > S.submittedValue) {
        S.submittedValue = S.bestTurn;
        bestTrack.set(S.bestTurn);
        try {
          const res = await bestTrack.submit("best_turn", {
            label: `${S.bestTurn} in ${S.cfg.seconds}s`,
            dimensions: { length: S.cfg.seconds + "s" }
          });
          if (res && res.isPersonalBest) { S.personalBest = true; if (S.screen === "over") mount(); }
        } catch (e) { /* a refused write must never break the result screen */ }
      }

      if (ctx.pulse && ctx.pulse.complete) {
        ctx.pulse.complete({
          result: draw ? "draw" : "win",
          score: S.bestTurn,
          text: draw
            ? `${S.teams.map(t => t.score).sort((x, y) => y - x).join("–")} draw in Forbidden Five`
            : `${winner.name} won Forbidden Five on ${best}`
        });
      }
    }

    /* ================================================================ *
     * THE CLOCK
     * ================================================================ */
    function paintClock() {
      if (!S.turn) return;
      const left = Math.max(0, S.turn.msLeft);
      const secs = Math.ceil(left / 1000);
      if (secsNode) secsNode.textContent = secs;
      if (fillNode) fillNode.style.transform = "scaleX(" + (left / (S.cfg.seconds * 1000)) + ")";
      if (tallyNode) {
        tallyNode.textContent = (S.turn.points >= 0 ? "+" : "") + S.turn.points;
        tallyNode.classList.toggle("up", S.turn.points > 0);
        tallyNode.classList.toggle("down", S.turn.points < 0);
      }
      stage.classList.toggle("ff-warn", secs <= WARN_AT);
    }

    function tick(dtMs) {
      if (S.screen !== "play" || !S.turn || !S.turn.running) return;
      const dt = Math.min(dtMs || 16, 250);
      S.turn.msLeft -= dt;

      const secs = Math.max(0, Math.ceil(S.turn.msLeft / 1000));
      if (secs !== S.turn.lastWholeSecond) {
        S.turn.lastWholeSecond = secs;
        // The last few seconds tick audibly, which is the whole reason
        // anybody panics and blurts out a forbidden word.
        if (secs > 0 && secs <= WARN_AT) { sfx.tick(); haptic("light"); }
      }
      paintClock();
      if (S.turn.msLeft <= 0) endTurn();
    }

    if (ctx.game && ctx.game.loop) ctx.game.loop({ update: tick });
    else ctx.onFrame(dt => tick(dt));

    ctx.listen(window, "resize", applySafeArea);

    /* ================================================================ *
     * BOOT
     * ================================================================ */
    mount();
    ctx.markVisualReady("setup");
    // Saved team names and rules arrive a beat later and simply repaint.
    await loadSaved();
    mount();
    ctx.platform.ready({ title: "Forbidden Five" });
  }
};
