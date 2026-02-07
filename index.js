require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  Events,
  ActivityType
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior,
  StreamType
} = require("@discordjs/voice");

const { Readable } = require("stream");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const connections = new Map();
const players = new Map();
const speakingIntervals = new Map();

const commands = [
  new SlashCommandBuilder().setName("join").setDescription("Bot join voice AFK 24/7"),
  new SlashCommandBuilder().setName("leave").setDescription("Bot keluar voice")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);
(async () => {
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("🌍 Global command ready");
})();

function createInfiniteSilentStream() {
  return new Readable({
    read() {
      this.push(Buffer.alloc(3840));
    }
  });
}

function forceSpeaking(guildId, player) {
  if (speakingIntervals.has(guildId)) return;
  const interval = setInterval(() => {
    try { player.stop(true); } catch {}
  }, 30000);
  speakingIntervals.set(guildId, interval);
}

function keepAliveVoice(guildId, connection) {
  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play }
  });

  players.set(guildId, player);

  const resource = createAudioResource(createInfiniteSilentStream(), {
    inputType: StreamType.Raw
  });

  player.play(resource);
  connection.subscribe(player);
  forceSpeaking(guildId, player);

  player.on(AudioPlayerStatus.Idle, () => {
    player.play(resource);
  });
}

client.once(Events.ClientReady, (c) => {
  console.log(`🤖 Online sebagai ${c.user.tag}`);
  c.user.setActivity("AFK Voice 24/7 🎤", { type: ActivityType.Playing });
});

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand()) return;

  if (i.commandName === "join") {
    const vc = i.member.voice.channel;
    if (!vc) return i.reply({ content: "Masuk voice dulu", ephemeral: true });

    const connection = joinVoiceChannel({
      channelId: vc.id,
      guildId: i.guild.id,
      adapterCreator: i.guild.voiceAdapterCreator,
      selfMute: false,
      selfDeaf: false,
      preferredEncryptionModes: [
        "aead_xchacha20_poly1305_rtpsize",
        "aead_aes256_gcm_rtpsize"
      ]
    });

    connections.set(i.guild.id, connection);
    keepAliveVoice(i.guild.id, connection);

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000)
        ]);
      } catch {
        const newConn = joinVoiceChannel({
          channelId: vc.id,
          guildId: i.guild.id,
          adapterCreator: i.guild.voiceAdapterCreator,
          selfMute: false,
          selfDeaf: false,
          preferredEncryptionModes: [
            "aead_xchacha20_poly1305_rtpsize",
            "aead_aes256_gcm_rtpsize"
          ]
        });
        connections.set(i.guild.id, newConn);
        keepAliveVoice(i.guild.id, newConn);
      }
    });

    return i.reply("✅ Bot join voice (AFK 24/7)");
  }

  if (i.commandName === "leave") {
    const conn = connections.get(i.guild.id);
    if (!conn) return i.reply({ content: "Bot tidak di voice", ephemeral: true });

    conn.destroy();
    connections.delete(i.guild.id);

    if (speakingIntervals.has(i.guild.id)) {
      clearInterval(speakingIntervals.get(i.guild.id));
      speakingIntervals.delete(i.guild.id);
    }

    return i.reply("👋 Bot keluar voice");
  }
});

client.login(TOKEN);