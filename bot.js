const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const axios = require('axios');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent  // ADDED THIS INTENT
    ]
});

// Configuration for Jeddah, Saudi Arabia
const CONFIG = {
    CITY: 'Jeddah',
    COUNTRY: 'Saudi Arabia',
    METHOD: 4, // Muslim World League method
    TIMEZONE: 'Asia/Riyadh'
};

const player = createAudioPlayer();
let scheduledReminders = new Map();
let currentPrayerTimes = {};

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    // Set bot status
    client.user.setActivity('Prayer Reminders', { type: ActivityType.Listening });
    
    // Fetch today's prayer times and schedule reminders
    await fetchAndSchedulePrayerTimes();
    
    // Schedule daily prayer time updates at midnight
    scheduleDailyUpdates();
    
    console.log('Bot is ready and prayer times are scheduled!');
});

// Function to fetch prayer times from API
async function fetchPrayerTimes() {
    try {
        console.log('🔄 Fetching accurate prayer times from API...');
        
        const apiUrl = `https://api.aladhan.com/v1/timingsByCity?city=Jeddah&country=Saudi Arabia&method=4`;
        
        const response = await axios.get(apiUrl);
        const timings = response.data.data.timings;
        
        console.log('🔍 DEBUG - Raw API response times:', timings);
        
        currentPrayerTimes = {
            Fajr: timings.Fajr,
            Dhuhr: timings.Dhuhr,
            Asr: timings.Asr,
            Maghrib: timings.Maghrib,
            Isha: timings.Isha
        };
        
        console.log('📅 ACCURATE Prayer times fetched:', currentPrayerTimes);
        return currentPrayerTimes;
        
    } catch (error) {
        console.log('❌ API failed, using fallback times. Error:', error.message);
        currentPrayerTimes = {
            Fajr: '05:17',
            Dhuhr: '12:05',
            Asr: '15:15',
            Maghrib: '17:45',
            Isha: '19:15'
        };
        return currentPrayerTimes;
    }
}

// Fallback prayer times for Jeddah (approximate)
function getFallbackPrayerTimes() {
    const today = new Date();
    const month = today.getMonth() + 1;
    
    // Approximate prayer times for Jeddah throughout the year
    if (month >= 3 && month <= 5) { // Spring
        return {
            fajr: '04:45',
            dhuhr: '12:20', 
            asr: '15:45',
            maghrib: '18:30',
            isha: '20:00'
        };
    } else if (month >= 6 && month <= 8) { // Summer
        return {
            fajr: '04:15',
            dhuhr: '12:15',
            asr: '15:30',
            maghrib: '18:45',
            isha: '20:15'
        };
    } else if (month >= 9 && month <= 11) { // Autumn
        return {
            fajr: '04:50',
            dhuhr: '11:55',
            asr: '15:10',
            maghrib: '18:05',
            isha: '19:30'
        };
    } else { // Winter
        return {
            fajr: '05:30',
            dhuhr: '12:10',
            asr: '15:15',
            maghrib: '17:45',
            isha: '19:15'
        };
    }
}

// Fetch and schedule prayer times
async function fetchAndSchedulePrayerTimes() {
    try {
        currentPrayerTimes = await fetchPrayerTimes();
        scheduleAllPrayerReminders();
    } catch (error) {
        console.error('Error in fetchAndSchedulePrayerTimes:', error);
    }
}

// Schedule daily updates at midnight
function scheduleDailyUpdates() {
    // Run at 00:01 AM every day to update prayer times
    cron.schedule('1 0 * * *', async () => {
        console.log('Updating prayer times for new day...');
        await fetchAndSchedulePrayerTimes();
    });
    
    console.log('Daily prayer time updates scheduled at 00:01');
}

// Function to schedule all prayer reminders
function scheduleAllPrayerReminders() {
    // Clear all existing reminders
    scheduledReminders.forEach(reminders => {
        reminders.forEach(timeout => clearTimeout(timeout));
    });
    scheduledReminders.clear();
    
    console.log('Scheduling new prayer reminders for Jeddah...');
    
    for (const [prayerName, prayerTime] of Object.entries(currentPrayerTimes)) {
        schedulePrayerReminders(prayerName, prayerTime);
    }
}

// Function to schedule the three reminders for a single prayer
function schedulePrayerReminders(prayerName, prayerTimeStr) {
    const [hours, minutes] = prayerTimeStr.split(':').map(Number);
    
    // Use Saudi Arabia timezone explicitly
    const now = new Date();
    const prayerDate = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Riyadh"}));
    prayerDate.setHours(hours, minutes, 0, 0);
    
    console.log(`🕒 DEBUG: ${prayerName} at ${prayerTimeStr} -> ${prayerDate.toLocaleString()}`);
    
    if (prayerDate < now) {
        prayerDate.setDate(prayerDate.getDate() + 1);
    }
    
    const scheduleReminder = (offsetMinutes, message, shouldPing) => {
        const reminderTime = new Date(prayerDate.getTime() + offsetMinutes * 60 * 1000);
        const delay = reminderTime.getTime() - Date.now();
        
        console.log(`🕒 ${prayerName} reminder: ${message} at ${reminderTime.toLocaleString()} (in ${Math.round(delay/1000/60)} minutes)`);
        
        if (delay > 0) {
            const timeout = setTimeout(() => {
                sendPrayerReminderToAllChannels(prayerName, message, shouldPing);
            }, delay);
            
            scheduledTextReminders.set(`${prayerName}_${offsetMinutes}`, timeout);
        }
    };
    
    scheduleReminder(-5, `${prayerName} prayer in 5 minutes`, false);
    scheduleReminder(0, `${prayerName} prayer time now`, true);
    scheduleReminder(10, `${prayerName} prayer was 10 minutes ago`, false);
}

// Function to play reminder in a specific voice channel
async function playReminderInChannel(voiceChannel, message) {
    try {
        // Join the voice channel
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });

        // Wait for connection to be ready
        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
            
            // Subscribe to the audio player
            const subscription = connection.subscribe(player);
            
            if (subscription) {
                // Play the MP3 file
                const resource = createAudioResource(getPrayerSound());
                player.play(resource);

                // Leave after the sound finishes playing
                player.once('idle', () => {
                    setTimeout(() => {
                        connection.destroy();
                    }, 1000);
                });

                // Error handling
                player.on('error', error => {
                    console.error('Error playing audio:', error);
                    connection.destroy();
                });
            }
        } catch (error) {
            console.error('Failed to connect to voice channel:', error);
            connection.destroy();
        }

        // Handle connection disruptions
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
            } catch (error) {
                connection.destroy();
            }
        });

    } catch (error) {
        console.error('Error joining voice channel:', error);
    }
}

// Function to get the prayer sound file
function getPrayerSound() {
    // For Railway deployment - handle missing MP3 files gracefully
    const soundPath = path.join(__dirname, 'prayer_reminder.mp3');
    
    if (!fs.existsSync(soundPath)) {
        console.log('MP3 file not found on Railway - reminders will work without sound');
        // Return a dummy path - the bot will still join voice channels
        return soundPath;
    }
    
    return soundPath;
}

// === DEBUG LOGGING ===
client.on('messageCreate', (message) => {
    console.log('📨 Received message:', message.content, 'from:', message.author.username);
});

// Add some basic commands
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    if (message.content === '!prayertimes') {
        console.log('Processing !prayertimes command');
        let response = `🕌 Today's Prayer Times for ${CONFIG.CITY}, ${CONFIG.COUNTRY}:\n`;
        for (const [prayer, time] of Object.entries(currentPrayerTimes)) {
            response += `**${prayer.charAt(0).toUpperCase() + prayer.slice(1)}**: ${time}\n`;
        }
        response += `\n⏰ Timezone: ${CONFIG.TIMEZONE}`;
        
        try {
            await message.channel.send(response);
            console.log('Successfully sent prayer times');
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }
    
    if (message.content === '!refreshprayertimes') {
        console.log('Processing !refreshprayertimes command');
        await fetchAndSchedulePrayerTimes();
        try {
            await message.channel.send('🔄 Prayer times updated for Jeddah!');
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }
    
    if (message.content === '!prayerhelp') {
        console.log('Processing !prayerhelp command');
        const helpMessage = `
**🕌 Islamic Prayer Reminder Bot Commands:**
\`!prayertimes\` - Show today's prayer times for Jeddah
\`!refreshprayertimes\` - Manually update prayer times
\`!prayerhelp\` - Show this help message

**Reminders:** 
- 5 minutes before prayer
- At prayer time 
- 10 minutes after prayer

The bot automatically joins voice channels with users to play reminders.
        `;
        try {
            await message.channel.send(helpMessage);
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }
});

// Error handling
process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);

