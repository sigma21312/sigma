const {
    Client,
    GatewayIntentBits,
    Partials,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    Collection
} = require('discord.js');


const TOKEN = 'MTM4NzExNTIxNzMxNzY1ODY5NA.GsxpwW._BXXDgU1luWlvkqNFXcnf2obI-tVeX-z4YL_-U'; // Replace with your bot token
const APP_ID = '1387115217317658694'; // Replace with your app ID

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User],
});

// Utils
function bold(text) {
    return `**${text}**`;
}

function getRandomColor() {
    return `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;
}

function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch {
        return false;
    }
}

function formatMessage(username, content) {
    return `${bold(username)} :telephone_receiver: ${content}`;
}

// Globals
const callQueue = []; // [{ userId, guildId, channelId }]
const activeCalls = new Map(); // userId => { userId, guildId, channelId }
const userStats = new Collection(); // userId => number of calls

// Commands
const commands = [
    new SlashCommandBuilder().setName('call').setDescription('Find and connect with a random user'),
    new SlashCommandBuilder().setName('hangup').setDescription('End your current call'),
    new SlashCommandBuilder()
        .setName('sendimage')
        .setDescription('Send image or gif link')
        .addStringOption(option =>
            option.setName('url')
                .setDescription('Direct or page link to image or gif')
                .setRequired(true)
        ),
    new SlashCommandBuilder().setName('stats').setDescription('Show your call stats'),
];

// Register commands globally
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        console.log('Registering commands...');
        await rest.put(
            Routes.applicationCommands(APP_ID),
            { body: commands.map(cmd => cmd.toJSON()) }
        );
        console.log('Commands registered!');
    } catch (e) {
        console.error('Command registration failed:', e);
    }
}

// Create embed for call connect showing partner profile
function createPartnerProfileEmbed(user) {
    return new EmbedBuilder()
        .setColor(getRandomColor())
        .setTitle('📞 Call Connected!')
        .setDescription(`${bold('You are now connected with')} **${user.tag}**`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 512 }))
        .addFields(
            { name: 'Username', value: user.username, inline: true },
            { name: 'User ID', value: user.id, inline: true },
            { name: 'Created On', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`, inline: false }
        )
        .setFooter({ text: 'ViralChat' })
        .setTimestamp();
}

function userInQueue(userId) {
    return callQueue.some(e => e.userId === userId);
}

function userInCall(userId) {
    return activeCalls.has(userId);
}

function getPartner(userId) {
    return activeCalls.get(userId);
}

// Event handlers

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    await registerCommands();
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const user = interaction.user;
    const cmd = interaction.commandName;

    if (cmd === 'call') {
        if (userInCall(user.id)) return interaction.reply({ content: '❌ You are already in a call! Use /hangup.', ephemeral: false });
        if (userInQueue(user.id)) return interaction.reply({ content: '⏳ You are already waiting for a match...', ephemeral: false });

        // find partner
        let partnerEntry = null;
        for (const e of callQueue) {
            if (e.userId !== user.id && !userInCall(e.userId)) {
                partnerEntry = e;
                break;
            }
        }

        if (partnerEntry) {
            // remove partner from queue
            callQueue.splice(callQueue.findIndex(e => e.userId === partnerEntry.userId), 1);

            // create call active for both
            activeCalls.set(user.id, partnerEntry);
            activeCalls.set(partnerEntry.userId, { userId: user.id, guildId: interaction.guildId, channelId: interaction.channelId });

            userStats.set(user.id, (userStats.get(user.id) || 0) + 1);
            userStats.set(partnerEntry.userId, (userStats.get(partnerEntry.userId) || 0) + 1);

            // fetch partner user
            const partnerUser = await client.users.fetch(partnerEntry.userId);

            // Send partner profile embed to caller
            await interaction.reply({ embeds: [createPartnerProfileEmbed(partnerUser)], ephemeral: false });

            // Send partner profile embed to partner's channel
            try {
                const guild = client.guilds.cache.get(partnerEntry.guildId);
                const channel = guild.channels.cache.get(partnerEntry.channelId);
                if (channel) {
                    await channel.send({ embeds: [createPartnerProfileEmbed(user)] });
                }
            } catch (err) {
                console.error('Error sending partner embed:', err);
            }

        } else {
            callQueue.push({ userId: user.id, guildId: interaction.guildId, channelId: interaction.channelId });
            await interaction.reply({ content: '⏳ Waiting for someone to connect...', ephemeral: false });
        }
    }

    else if (cmd === 'hangup') {
        if (!userInCall(user.id) && !userInQueue(user.id))
            return interaction.reply({ content: '❌ You are not in a call or waiting queue.', ephemeral: false });

        if (userInQueue(user.id)) {
            callQueue.splice(callQueue.findIndex(e => e.userId === user.id), 1);
            return interaction.reply({ content: '✅ You left the waiting queue.', ephemeral: false });
        }

        const partnerEntry = getPartner(user.id);
        activeCalls.delete(user.id);
        if (partnerEntry) activeCalls.delete(partnerEntry.userId);

        await interaction.reply({ content: '📴 Call ended.' });

        try {
            const guild = client.guilds.cache.get(partnerEntry.guildId);
            const channel = guild.channels.cache.get(partnerEntry.channelId);
            if (channel) await channel.send(`📴 Your call partner **${user.tag}** has ended the call.`);
        } catch { }
    }

    else if (cmd === 'sendimage') {
        const url = interaction.options.getString('url');
        if (!isValidUrl(url)) {
            return interaction.reply({ content: '❌ Please provide a valid URL.', ephemeral: false });
        }
        await interaction.reply({ content: bold(url), ephemeral: false });
    }

    else if (cmd === 'stats') {
        const calls = userStats.get(user.id) || 0;
        await interaction.reply({ content: `📊 You have participated in **${calls}** calls.`, ephemeral: false });
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!activeCalls.has(message.author.id)) return;
    if (message.content.startsWith('/')) return; // ignore commands

    const partnerEntry = activeCalls.get(message.author.id);
    if (!partnerEntry) return;

    try {
        const guild = client.guilds.cache.get(partnerEntry.guildId);
        const channel = guild.channels.cache.get(partnerEntry.channelId);
        if (!channel) return;

        // Format text message: **username** :telephone_receiver: message
        const userPrefix = bold(message.author.username) + ' :telephone_receiver:';

        // If message has attachments (images, gifs), send them along
        if (message.attachments.size > 0) {
            // Send text + attachments to partner channel
            await channel.send({ content: `${userPrefix} ${message.content || ''}`.trim(), files: [...message.attachments.values()] });
        } else {
            // Send just formatted text message
            await channel.send(`${userPrefix} ${message.content}`);
        }
    } catch (err) {
        console.error('Error forwarding message:', err);
    }
});

client.login(TOKEN);
