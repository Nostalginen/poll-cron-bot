const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

// Aikavyöhykeasetus
const TIMEZONE = "Europe/Helsinki"; 
const STATE_FILE = path.join(__dirname, 'data', 'poll_state.json');

const pollQuestion = "Tuletko treeneihin tänään?";
const pollOptions = [
    { id: 'kylla', name: 'Kyllä, tulen!', emoji: '✅' },
    { id: 'kyyti_tarjoan', name: 'Tulen ja voin ottaa kyytiin', emoji: '🚙' },
    { id: 'kyyti_tarve', name: 'Tulen, mutta tarvitsen kyydin', emoji: '🙋' }
];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

function loadState() {
    if (fs.existsSync(STATE_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        } catch (e) {
            console.error("Virhe ladattaessa tilatiedostoa:", e);
        }
    }
    return { activePollMessageId: null, channelId: null, votes: {} };
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function createPollEmbed(votes) {
    const counts = { kylla: 0, kyyti_tarjoan: 0, kyyti_tarve: 0 };
    Object.values(votes).forEach(optionId => {
        if (counts[optionId] !== undefined) counts[optionId]++;
    });

    const totalVotes = Object.keys(votes).length;
    const embed = new EmbedBuilder()
        .setTitle(pollQuestion)
        .setColor('#2b2d31')
        .setDescription('Äänestä klikkaamalla alla olevia painikkeita.\n\n*Äänestys on täysin anonyymi (kukaan ei näe kuka äänesti mitäkin).*')
        .setTimestamp();

    pollOptions.forEach(option => {
        const count = counts[option.id];
        const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
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

// Funktio uuden pollin luomiseen
async function sendNewPoll() {
    console.log('Luodaan uusi päivän kysely...');
    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) return console.error('Kanavaa ei löytynyt.');

        const newState = { activePollMessageId: null, channelId: CHANNEL_ID, votes: {} };
        const embed = createPollEmbed(newState.votes);
        const components = createPollButtons();

        const message = await channel.send({ embeds: [embed], components: components });
        newState.activePollMessageId = message.id;
        saveState(newState);
        console.log('Uusi kysely luotu onnistuneesti.');
    } catch (error) {
        console.error('Virhe uuden kyselyn luonnissa:', error);
    }
}

// Funktio vanhan pollin poistamiseen
async function deleteActivePoll() {
    console.log('Tarkistetaan poistettavaa kyselyä...');
    const state = loadState();
    if (state.activePollMessageId && state.channelId) {
        try {
            const channel = await client.channels.fetch(state.channelId);
            if (channel) {
                const message = await channel.messages.fetch(state.activePollMessageId);
                if (message) {
                    await message.delete();
                    console.log('Vanha kysely viesti poistettu kokonaan.');
                }
            }
        } catch (error) {
            console.error('Viestiä ei voitu poistaa chätistä:', error);
        } finally {
            // Tyhjennetään tila poiston jälkeen
            saveState({ activePollMessageId: null, channelId: null, votes: {} });
        }
    }
}

// Apufunktio: Onko nyt sallittu aika luoda polli (Ma, Ti, To, Pe, La ja klo >= 08:00)
function shouldPollBeActiveRightNow() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: TIMEZONE,
        hour: 'numeric',
        hour12: false,
        weekday: 'short'
    }).formatToParts(now);

    const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
    const day = parts.find(p => p.type === 'weekday').value; // Mon, Tue, Thu, Fri, Sat, Sun, Wed

    const allowedDays = ['Mon', 'Tue', 'Thu', 'Fri', 'Sat'];
    return allowedDays.includes(day) && hour >= 8;
}

client.once('ready', () => {
    console.log(`Botti on linjoilla! Kirjautunut sisään tunnuksella: ${client.user.tag}`);

    // KÄYNNISTYSTARKISTUS (Jos botti kutsutaan kesken päivän)
    const state = loadState();
    if (!state.activePollMessageId) {
        if (shouldPollBeActiveRightNow()) {
            console.log('Kello on yli 08:00 ja tänään on kyselypäivä, eikä aktiivista kyselyä löytynyt. Luodaan kysely...');
            sendNewPoll();
        } else {
            console.log('Ei tarvetta luoda kyselyä juuri nyt (väärä päivä, ennen klo 08:00 tai ollaan jo yössä). Odotetaan cron-ajastuksia.');
        }
    } else {
        console.log('Aktiivinen kysely on jo käynnissä tiedonhallinnassa. Ei luoda tuplaa.');
    }

    // CRON: Luo uusi kysely Ma, Ti, To, Pe, La klo 08:00
    cron.schedule('0 8 * * 1,2,4,5,6', () => {
        sendNewPoll();
    }, {
        scheduled: true,
        timezone: TIMEZONE
    });

    // CRON: Poista kysely joka yö klo 00:00
    cron.schedule('0 0 * * *', () => {
        deleteActivePoll();
    }, {
        scheduled: true,
        timezone: TIMEZONE
    });
});

// Äänestyspainikkeiden käsittely (Pysyy samana)
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('poll_')) return;

    const state = loadState();

    if (interaction.message.id !== state.activePollMessageId) {
        return interaction.reply({ content: 'Tämä äänestys on jo päättynyt tai poistettu.', ephemeral: true });
    }

    const optionId = interaction.customId.replace('poll_', '');
    const userId = interaction.user.id;

    saveState(state);
    await interaction.update({ embeds: [createPollEmbed(state.votes)] });
    
});

client.login(TOKEN);