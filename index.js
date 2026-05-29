const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

// Timezone configuration (Change to your region if necessary)
const TIMEZONE = "Europe/Helsinki"; 

const STATE_FILE = path.join(__dirname, 'data', 'poll_state.json');

const pollQuestion = "Pääsetkö treeneihin tänään?";
const pollOptions = [
    { id: 'kylla', name: 'Kyllä, tulen!', emoji: '✅' },
    { id: 'kyyti_tarjoan', name: 'Tulen ja voin ottaa kyytiin', emoji: '🚙' },
    { id: 'kyyti_tarve', name: 'Tulen, mutta tarvitsen kyydin', emoji: '🙋' }
];

// Initialize Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

// Helper functions for state persistence (prevents data loss if bot restarts)
function loadState() {
    if (fs.existsSync(STATE_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        } catch (e) {
            console.error("Error loading state file, resetting state:", e);
        }
    }
    return { activePollMessageId: null, channelId: null, votes: {} };
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// Generates the visual Embed with up-to-date counts
function createPollEmbed(votes) {
    const counts = { kylla: 0, kyyti_tarjoan: 0, kyyti_tarve: 0 };
    
    // Calculate total votes and counts per option
    Object.values(votes).forEach(optionId => {
        if (counts[optionId] !== undefined) {
            counts[optionId]++;
        }
    });

    const totalVotes = Object.keys(votes).length;

    const embed = new EmbedBuilder()
        .setTitle(pollQuestion)
        .setColor('#2b2d31') // Discord dark theme grey background color
        .setDescription('Äänestä klikkaamalla alla olevia painikkeita.\n\n*Äänestys on täysin anonyymi (kukaan ei näe kuka äänesti mitäkin).*')
        .setTimestamp();

    pollOptions.forEach(option => {
        const count = counts[option.id];
        const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        
        // Simple visual progress bar UI
        const totalBars = 10;
        const filledBars = Math.round((percentage / 100) * totalBars);
        const emptyBars = totalBars - filledBars;
        const progressBar = '🟩'.repeat(filledBars) + '⬜'.repeat(emptyBars);

        embed.addFields({
            name: `${option.emoji} ${option.name}`,
            value: `${progressBar} **${count}** ääntä (${percentage}%)`,
            inline: false
        });
    });

    embed.setFooter({ text: `Yhteensä äänestäjiä: ${totalVotes}` });

    return embed;
}

// Generates the interactive buttons
function createPollButtons() {
    const row = new ActionRowBuilder();
    
    pollOptions.forEach(option => {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`poll_${option.id}`)
                .setLabel(option.name)
                .setEmoji(option.emoji)
                .setStyle(ButtonStyle.Secondary)
        );
    });

    return [row];
}

client.once('ready', () => {
    console.log(`Bot is online! Logged in as: ${client.user.tag}`);

    // Cron syntax: minute hour day-of-month month day-of-week
    // Days: 1=Mon, 2=Tue, 4=Thu, 5=Fri, 6=Sat
    cron.schedule('0 8 * * 1,2,4,5,6', async () => {
        console.log('Posting scheduled poll...');
        try {
            const channel = await client.channels.fetch(CHANNEL_ID);
            if (!channel) return console.error('Channel not found.');

            // Clear previous votes and prepare a fresh state
            const newState = {
                activePollMessageId: null,
                channelId: CHANNEL_ID,
                votes: {}
            };

            const embed = createPollEmbed(newState.votes);
            const components = createPollButtons();

            const message = await channel.send({
                embeds: [embed],
                components: components
            });

            newState.activePollMessageId = message.id;
            saveState(newState);
            console.log('New poll posted successfully.');
        } catch (error) {
            console.error('Error sending scheduled poll:', error);
        }
    }, {
        scheduled: true,
        timezone: TIMEZONE
    });

    // Delete Poll Cron Job: Every single day at midnight (00:00)
    cron.schedule('0 0 * * *', async () => {
        console.log('Midnight reached, checking for active polls to delete...');
        const state = loadState();
        if (state.activePollMessageId && state.channelId) {
            try {
                const channel = await client.channels.fetch(state.channelId);
                if (channel) {
                    const message = await channel.messages.fetch(state.activePollMessageId);
                    if (message) {
                        await message.delete();
                        console.log('Poll deleted successfully at midnight.');
                    }
                }
            } catch (error) {
                console.error('Error deleting poll message at midnight (it might have been deleted manually):', error);
            } finally {
                // Completely wipe the state clean
                saveState({ activePollMessageId: null, channelId: null, votes: {} });
            }
        }
    }, {
        scheduled: true,
        timezone: TIMEZONE
    });
});

// Handle Button Interactions (Voting logic)
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('poll_')) return;

    const state = loadState();

    // Prevent users from interacting with legacy/bugged poll clicks
    if (interaction.message.id !== state.activePollMessageId) {
        return interaction.reply({ content: 'Tämä äänestys on jo päättynyt tai poistettu.', ephemeral: true });
    }

    const optionId = interaction.customId.replace('poll_', '');
    const userId = interaction.user.id;

    let responseMessage = '';

    // If clicking the exact same option, remove their vote. Otherwise, change/add it.
    if (state.votes[userId] === optionId) {
        delete state.votes[userId];
        responseMessage = 'Äänesi on poistettu!';
    } else {
        state.votes[userId] = optionId;
        responseMessage = 'Äänesi on rekisteröity / muutettu!';
    }

    // Save state instantly
    saveState(state);

    // Update the message layout with new results in real-time
    await interaction.update({ embeds: [createPollEmbed(state.votes)] });

    // Send a private ephemeral confirmation so only the user knows their vote worked
    await interaction.followUp({ content: responseMessage, ephemeral: true });
});

client.login(TOKEN);