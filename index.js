const { SKIPPED_DATES, isTodaySkipped } = require('./skippedDates.js');
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;


const TIMEZONE = "Europe/Helsinki"; 
const STATE_FILE = path.join(__dirname, 'data', 'poll_state.json');

const pollQuestion = "Tuletko treeneihin tänään? | Are you coming to practice today?";
const pollOptions = [
   { id: 'kylla', name: 'Kyllä | Yes', emoji: '✅' },
   { id: 'kyyti_tarjoan', name: 'Kyllä, voin kyyditä | Yes, can carpool', emoji: '🚙' },
   { id: 'kyyti_tarve', name: 'Kyllä, tarvin kyydin | Yes, need a ride', emoji: '🙋' }
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

    // 1. Haetaan tämän päivän viikonpäivä Helsingin ajassa
    const helsinkiTime = new Date().toLocaleString("en-US", { timeZone: TIMEZONE });
    const localDate = new Date(helsinkiTime);
    const dayOfWeek = localDate.getDay(); // 0=Su, 1=Ma, 2=Ti, 3=Ke, 4=To, 5=Pe, 6=La

    // 2. Määritetään treeniaika päivän mukaan
    let timeStr = "";
    if (dayOfWeek === 1 || dayOfWeek === 2) {
        timeStr = "19:00 - 21:00";
    } else if (dayOfWeek === 4 || dayOfWeek === 5) {
        timeStr = "18:00 - 20:00";
    } else if (dayOfWeek === 6) {
        timeStr = "15:15 - 17:00";
    }

    const embed = new EmbedBuilder()
        .setTitle(pollQuestion)
        .setColor('#2b2d31')
        .setDescription('Äänestä klikkaamalla alla olevia painikkeita.\n*Äänestys on täysin anonyymi.*\n\n' +
                        'Vote by clicking the buttons below.\n*The poll is completely anonymous.*\n\n')
        .setTimestamp();

    // 3. LISÄTÄÄN KELLONAIKA OTSIKON YLÄPUOLELLE (Author-kenttä)
    if (timeStr) {
        embed.setAuthor({ name: `⏱️ Treeniaika | Practice time: ${timeStr}` });
    }


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

    embed.setFooter({ text: `Yhteensä äänestäjiä | Total voters: ${totalVotes}` });
    return embed;
}

function saveResultsToHistory(state) {
    const historyFile = path.join(__dirname, 'data', 'poll_history.xml');
    
    // Lasketaan äänet
    const counts = { kylla: 0, kyyti_tarjoan: 0, kyyti_tarve: 0 };
    Object.values(state.votes).forEach(optionId => {
        if (counts[optionId] !== undefined) counts[optionId]++;
    });
    const totalVotes = Object.keys(state.votes).length;
    
    // Haetaan oikea päivämäärä (vähennetään 5 min, jotta pysytään kyselypäivän puolella klo 00:00)
    const date = new Date();
    date.setMinutes(date.getMinutes() - 5);
    // 'sv-SE' tuottaa kätevän standardin YYYY-MM-DD muodon XML:ää varten
    const formattedDate = date.toLocaleDateString('sv-SE', { timeZone: TIMEZONE }); 

    // Jos tiedostoa ei ole olemassa, luodaan sille XML-perusrakenne
    if (!fs.existsSync(historyFile)) {
        const initialXml = `<?xml version="1.0" encoding="UTF-8"?>\n<history>\n</history>`;
        fs.writeFileSync(historyFile, initialXml, 'utf8');
    }

    // Luodaan uusi XML-elementti tämän päivän tuloksista
    const pollXml = `  <poll date="${formattedDate}">\n` +
                    `    <question>${pollQuestion}</question>\n` +
                    `    <totalVotes>${totalVotes}</totalVotes>\n` +
                    `    <results>\n` +
                    `      <option id="kylla" count="${counts.kylla}">Kyllä, tulen!</option>\n` +
                    `      <option id="kyyti_tarjoan" count="${counts.kyyti_tarjoan}">Tulen ja voin ottaa kyytiin</option>\n` +
                    `      <option id="kyyti_tarve" count="${counts.kyyti_tarve}">Tulen, mutta tarvitsen kyydin</option>\n` +
                    `    </results>\n` +
                    `  </poll>\n</history>`;

    // Luetaan nykyinen tiedosto ja korvataan lopetus-tagi uudella datalla (pysyy validina XML:nä)
    let fileContent = fs.readFileSync(historyFile, 'utf8');
    fileContent = fileContent.replace('</history>', pollXml);
    
    fs.writeFileSync(historyFile, fileContent, 'utf8');
    console.log('Kyselyn tulokset tallennettu XML-historiaan.');
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
    if (isTodaySkipped()) {
        console.log('Tämän päivän treenit on merkitty skipatuksi listalla. Kyselyä ei luoda.');
        return;
    }
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

    try {
            saveResultsToHistory(state);
        } catch (historyError) {
            console.error('Virhe historian tallentamisessa:', historyError);
        }

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
    if (isTodaySkipped()) {
        console.log('Käynnistystarkistus: Päivä löytyy SKIPPED_DATES-listalta, ei luoda kyselyä.');
        return false;
    }
    const now = new Date();
    
    // Haetaan Helsingin aika selkeinä merkkijonoina ilman riskiä AM/PM sekaannuksista
    const day = now.toLocaleString('en-US', { timeZone: TIMEZONE, weekday: 'short' }); // Mon, Tue...
    const hourStr = now.toLocaleString('en-US', { timeZone: TIMEZONE, hour: 'numeric', hourCycle: 'h23' });
    const hour = parseInt(hourStr, 10);

    console.log(`Botin sisäinen tarkistus -> Päivä: ${day}, Tunti: ${hour}`);

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

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('poll_')) return;

    const state = loadState();

    // Estetään vanhojen kyselyjen klikkailu
    if (interaction.message.id !== state.activePollMessageId) {
        return interaction.reply({ content: 'Tämä äänestys on jo päättynyt tai poistettu.', ephemeral: true });
    }

    const optionId = interaction.customId.replace('poll_', '');
    const userId = interaction.user.id;

    // Lisätään tai poistetaan ääni muistista
    if (state.votes[userId] === optionId) {
        delete state.votes[userId];
    } else {
        state.votes[userId] = optionId;
    }

    // Tallennetaan tila JSON-tiedostoon
    saveState(state);

    // Päivitetään pelkkä upotus (embed) reaaliajassa.
    // Tämä komento riittää kuittaamaan napin painalluksen Discordille, eikä "Lataa viestiä..." -rulla jää pyörimään.
    await interaction.update({ embeds: [createPollEmbed(state.votes)] });
});

client.login(TOKEN);