require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');

const CHANNEL_ID = 'PUT_DISCORD_CHANNEL_ID_HERE'; // paste your channel ID

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    const ch = await client.channels.fetch(CHANNEL_ID);
    if (!ch || ch.type !== ChannelType.GuildText) throw new Error('Bad channel');
    await ch.send('✅ Bot can post messages.');
    console.log('Posted test message.');
  } catch (e) {
    console.error('Post failed:', e.message);
  }
});

client.login(process.env.DISCORD_TOKEN);
