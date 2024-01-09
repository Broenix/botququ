require('dotenv').config();

const tmi = require('tmi.js');
const apiKey = process.env.OPENAI_API_KEY;
const twitchOAuthToken = process.env.TWITCH_OAUTH_TOKEN;
const obsWebSocketPassword = process.env.OBS_WEBSOCKET_PASSWORD;
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const { default: OBSWebSocket } = require('obs-websocket-js');
const obs = new OBSWebSocket();
const fuzzball = require('fuzzball');
const motsDuJour = ['bon', 'heureux', 'grave'];
const app = express();
const port = 3000;
const coeursMapping = {
  rouge: {
    1: 9, 2: 8, 3: 10, 4: 11, 5: 12,
    6: 13, 7: 14, 8: 15, 9: 16, 10: 17
  },
  jaune: {
    0: 19, 1: 21, 2: 22, 3: 23, 4: 24,
    5: 25, 6: 26, 7: 27, 8: 28, 9: 29
  }
};
const bot = new tmi.Client({
  options: { debug: true },
  connection: {
    reconnect: true,
  },
  identity: {
    username: 'botququ',
    password: twitchOAuthToken,
  },
  channels: ['oderun'],
});
// Questions et réponses
const questions = [
  { question: "Quelle est ma date de naissance ? (JJ/MM/AAAA)", reponse: "15/09/1991" },
  { question: "Quelle est ma couleur favoris ?", reponse: "Gris" },
  { question: "Quel est mon animal totem ?", reponse: "sanglier" },
  { question: "Quel est mon signe astrologique ?", reponse: "vierge" },
  { question: "Quel est mon plat favoris", reponse: "Porc au caramel" },
  { question: "Quel est mon dessert favoris", reponse: "foret noire" },
  { question: "Quel pays je reve de visiter", reponse: "japon" },
  { question: "Street food favoris", reponse: "kebab" },
  { question: "Quel est le nom de ma tortue", reponse: "Janine" },
  { question: "Quel est mon animal favoris", reponse: "chien" },
  { question: "Quel est mon film pas d'animation favoris", reponse: "12 hommes en colère" },
  { question: "Quel est mon film d'animation favoris", reponse: "Le voyage de Chihiro" },
  { question: "Quel est le pays le plus loin de la France ou je suis allé", reponse: "australie" },
  { question: "Je suis plutôt de gauche ou de droite", reponse: "gauche" },
  { question: "Quel est mon film Twilight favoris", reponse: "premier" },
  { question: "Mon manga favoris", reponse: "hunter x hunter"},
  { question: "Mon anime favoris", reponse: "jujutsu kaisen"},
  { question: "Mon jeu auquel je joue le plus", reponse: "isaac"},
  { question: "Le meilleur jeu du monde selon moi", reponse: "Outer Wilds"},
  { question: "Mon fruit favoris", reponse: "fraise"},
  { question: "Mon signe du zodiaque chinois", reponse: "chevre"},
  { question: "Mon style de musique favoris", reponse: "rap"},
  { question: "Mon rappeur favoris", reponse: "Kanye West"},
  { question: "Ma plus grande phobie", reponse: "profondeurs"},
  { question: "Ma recette que je fais le mieux", reponse: "Pâtes au bleu*"},
];

let coeursRougesActifs = [];
let coeursJaunesActifs = [];
let tempsRestant;
let intervalleTimer;
let joueursAyantDejaJoue = new Set();
let scenePrecedente;
let motsRestants = [...motsDuJour];
let partieCommencee = false;
let numeroQuestionActuelle = 0;
let dernierePartieTimestamp = 0;
let questionActuelle = null;
let bonnesReponsesConsecutives = 0;
let viewerInitiateur = null;
let questionsRestantes = [...questions];
let echecs = 0;
let pokemonActuel = null;
let pokemonCapturePar = {};

app.use(bodyParser.json());

// Route pour recevoir des messages du bot Twitch
app.post('/ask', async (req, res) => {
    const question = req.body.question;

    try {
        const response = await axios.post('https://api.openai.com/v1/engines/davinci-codex/completions', {
            prompt: question,
            max_tokens: 150
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        const reply = response.data.choices[0].text.trim();
        res.json({ reply });
    } catch (error) {
        console.error(error);
        res.status(500).send("Erreur lors de l'interrogation de l\'API d\'OpenAI");
    }
});

app.listen(port, () => {
    console.log(`Serveur backend en écoute sur http://localhost:${port}`);
});

obs.connect('ws://192.168.1.48:4444', obsWebSocketPassword)
  .then(() => {
    console.log('Connecté à OBS');

    obs.call('GetVersion').then(response => {
      console.log('Version d\'OBS WebSocket:', response.obsWebSocketVersion);

      obs.call('GetCurrentProgramScene').then(response => {
        console.log('Scène actuelle:', response.currentProgramSceneName);
      }).catch(err => {
        console.error('Erreur lors de la récupération de la scène actuelle:', err);
      });

      obs.call('GetSceneItemList', { "sceneName": "Pokemon" }).then(response => {
        console.log('Liste items:', response.sceneItems);
      }).catch(err => {
        console.error('Erreur lors de la récupération de la liste des items de la scène:', err);
      });

      obs.call('GetSceneList').then(response => {
        console.log('Liste des scènes:', response.scenes);
      }).catch(err => {
        console.error('Erreur lors de la récupération de la liste des scènes:', err);
      });
    }).catch(err => {
      console.error('Erreur lors de la récupération de la version d\'OBS WebSocket:', err);
    });
  }).catch(err => {
    console.error('Erreur de connexion à OBS:', err);
  });

function activerGroupeVictoire() {
  const sceneItemId = 53/* ID du groupe 'victoire' */;
  obs.call('SetSceneItemEnabled', {
    'sceneName': 'ZAMOUR', // Nom de votre scène dans OBS
    'sceneItemId': sceneItemId, // ID de l'élément de scène pour le groupe 'victoire'
    'sceneItemEnabled': true // Mettre à true pour activer l'élément
  }).then(() => {
    console.log('Groupe victoire activé');
  }).catch(err => {
    console.error('Erreur lors de l\'activation du groupe victoire:', err);
  });
}

function changerSceneZamour() {
  obs.call('GetCurrentProgramScene').then(response => {
    scenePrecedente = response.currentProgramSceneName;
    obs.call('SetCurrentProgramScene', {
      'sceneName': 'ZAMOUR'
    }).then(() => {
      console.log('Scène changée en ZAMOUR');
    }).catch(err => {
      console.error('Erreur lors du changement de scène:', err);
    });
  }).catch(err => {
    console.error('Erreur lors de la récupération de la scène actuelle:', err);
  });
}

function retournerScenePrecedente() {
  setTimeout(() => {
    obs.call('SetCurrentProgramScene', {
      'sceneName': scenePrecedente
    }).catch(err => {
      console.error('Erreur lors du retour à la scène précédente:', err);
    });
    // Désactiver le groupe victoire après un délai pour le laisser visible un instant
    setTimeout(() => {
      desactiverGroupeVictoire();
    }, 4999); // Délai de 3 secondes avant de désactiver le groupe victoire
  }, 5000); // Pause de 5 secondes avant de changer la scène
}

function desactiverGroupeVictoire() {
  const sceneItemId = 53; // ID du groupe 'victoire'
  obs.call('SetSceneItemEnabled', {
    'sceneName': 'ZAMOUR',
    'sceneItemId': sceneItemId,
    'sceneItemEnabled': false
  }).then(() => {
    console.log('Groupe victoire désactivé');
  }).catch(err => {
    console.error('Erreur lors de la désactivation du groupe victoire:', err);
  });
}

function reponseCorrecte() {
  // Envoyer la commande pour afficher l'image sur l'overlay
  const sceneItemId = coeursMapping.rouge[numeroQuestionActuelle];
  coeursRougesActifs.push(sceneItemId);
  obs.call('SetSceneItemEnabled', {
    'sceneName': 'ZAMOUR', // Name of your scene in OBS
    'sceneItemId': sceneItemId,      // Numeric ID of the scene item (adjust as needed)
    'sceneItemEnabled': true // Set to true to enable the item
  }).then(() => {
    console.log('Scene item enabled');
  }).catch(err => {
    console.error('Error while enabling scene item:', err);
  });
}

function reponseIncorrecte() {
  // Envoyer la commande pour masquer l'image sur l'overlay
  const sceneItemId = coeursMapping.jaune[numeroQuestionActuelle];
  coeursJaunesActifs.push(sceneItemId);
  obs.call('SetSceneItemEnabled', {
    'sceneName': 'ZAMOUR', // Name of your scene in OBS
    'sceneItemId': sceneItemId,      // Numeric ID of the scene item (adjust as needed)
    'sceneItemEnabled': true // Set to true to enable the item
  }).then(() => {
    console.log('Scene item enabled');
  }).catch(err => {
    console.error('Error while enabling scene item:', err);
  });
}

function miseAJourTimer(channel) {
  tempsRestant--;
  fs.writeFileSync('timer.txt', tempsRestant.toString());

  if (tempsRestant <= 0) {
    clearInterval(intervalleTimer);
    bot.say(channel, 'Trop lent, désolé ! Plus de chance la prochaine fois !');
    // Réinitialiser le jeu
    joueursAyantDejaJoue.add(viewerInitiateur);
    reinitialiserJeu(channel);
  }
}

function reinitialiserJeu(channel) {
  setTimeout(() => {
    questionActuelle = null;
    bonnesReponsesConsecutives = 0;
    viewerInitiateur = null;
    echecs = 0;
    tempsRestant = 0;
    fs.writeFileSync('timer.txt', '');
    desactiverCoeurs();
    clearInterval(intervalleTimer);
    intervalleTimer = null;
    numeroQuestionActuelle = 0; // Réinitialiser le numéro de question actuelle
  }, 5000); // Délai de 5 secondes
}

function desactiverCoeurs() {
  coeursRougesActifs.concat(coeursJaunesActifs).forEach(sceneItemId => {
    obs.call('SetSceneItemEnabled', {
      'sceneName': 'ZAMOUR',
      'sceneItemId': sceneItemId,
      'sceneItemEnabled': false
    }).catch(err => {
      console.error('Error while disabling scene item:', err);
    });
  });

  // Réinitialiser les listes de cœurs activés
  coeursRougesActifs = [];
  coeursJaunesActifs = [];
}

function commencerJeuDesQuestions(channel) {
  questionActuelle = choisirQuestionAleatoire();
  bot.say(channel, `Question : ${questionActuelle.question}`);
  ecrireQuestionDansFichier(questionActuelle.question);

  // Démarrer le timer uniquement si la partie vient de commencer
  if (!intervalleTimer) {
    tempsRestant = 120; // Durée du timer en secondes
    intervalleTimer = setInterval(() => miseAJourTimer(channel), 1000);
  }
}

function ecrireQuestionDansFichier(question) {
  // Écrire la nouvelle question dans le fichier
  fs.writeFileSync('question.txt', '');
  fs.appendFileSync('question.txt', question);
}

// Fonction pour choisir une question au hasard dans la liste des questions restantes
function choisirQuestionAleatoire() {
  if (questionsRestantes.length === 0) {
    // Toutes les questions ont été posées, réinitialiser la liste des questions
    questionsRestantes = [...questions];
  }
  const index = Math.floor(Math.random() * questionsRestantes.length);
  const questionChoisie = questionsRestantes[index];
  return questionChoisie;
}

function jouerSonReponseCorrecte() {
  const inputName = 'correct'; // Nom de votre entrée média pour la réponse correcte
  obs.call('TriggerMediaInputAction', {
    'inputName': inputName,
    'mediaAction': 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
  }).then(() => {
    console.log('Son réponse correcte joué');
  }).catch(err => {
    console.error('Erreur lors de la lecture du son de la réponse correcte:', err);
  });
}

function jouerSonReponseIncorrecte() {
  const inputName = 'incorrect'; // Remplacez par le nom réel de votre entrée média
  obs.call('TriggerMediaInputAction', {
    'inputName': inputName,
    'mediaAction': 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
  }).then(() => {
    console.log('Son réponse incorrecte joué');
  }).catch(err => {
    console.error('Erreur lors de la lecture du son de la réponse incorrecte:', err);
  });
}

function verifierReponse(reponseDonnee, reponseAttendue) {
  // Nettoyer et normaliser les réponses
  const reponseDonneeNettoyee = reponseDonnee.toLowerCase().replace(/[^\w\s]/gi, '').trim();
  const motsReponseDonnee = reponseDonneeNettoyee.split(/\s+/);

  const reponseAttendueNettoyee = reponseAttendue.toLowerCase().replace(/[^\w\s]/gi, '').trim();
  const motsReponseAttendue = reponseAttendueNettoyee.split(/\s+/);

  // Vérifier chaque mot de la réponse donnée par rapport à la réponse attendue
  for (let motDonne of motsReponseDonnee) {
    for (let motAttendu of motsReponseAttendue) {
      const score = fuzzball.ratio(motDonne, motAttendu);
      if (score >= 80) { // Seuil ajustable pour la tolérance aux fautes de frappe
        return true;
      }
    }
  }

  // Fallback: vérifier si la réponse attendue est une sous-chaîne de la réponse donnée
  return reponseDonneeNettoyee.includes(reponseAttendueNettoyee);
}

function mettreAJourPoints(gagnant) {
  let points = lirePoints();
  if (points[gagnant]) {
    points[gagnant] += 10;
  } else {
    points[gagnant] = 10;
  }
  ecrirePoints(points);
}

function lirePoints() {
  if (fs.existsSync('viewerpoints.txt')) {
    const contenu = fs.readFileSync('viewerpoints.txt', 'utf8');
    return JSON.parse(contenu);
  } else {
    return {};
  }
}

function ecrirePoints(points) {
  fs.writeFileSync('viewerpoints.txt', JSON.stringify(points, null, 2));
}

async function getPokemonData(pokemonId) {
  try {
      const response = await axios.get(`https://pokeapi.co/api/v2/pokemon/${pokemonId}/`);
      return response.data;
  } catch (error) {
      console.error('Erreur lors de la récupération des données Pokémon:', error);
      return null;
  }
}

async function afficherPokemonAleatoire() {
  const pokemonId = Math.floor(Math.random() * 150) + 1; // ID aléatoire pour le Pokémon
  const pokemonData = await getPokemonData(pokemonId);
  const villageoisData = await getVillagerData(); // Données du villageois aléatoire

  if (pokemonData && villageoisData) {
    pokemonActuel = {
      id: pokemonId,
      nom: pokemonData.name
    };

    await afficherPokemonDansOBS(pokemonData.name, pokemonData.sprites.front_default);
    await afficherVillageoisDansOBS(villageoisData.name["name-USen"], villageoisData.image_uri);
  } else {
    console.log('Erreur lors de la récupération des données Pokémon ou Villageois');
  }
}



async function getVillagerData() {
  const maxVillagers = 391; // Nombre total de villageois dans ACNH
  const randomVillagerId = Math.floor(Math.random() * maxVillagers) + 1;
  try {
    const response = await axios.get(`http://acnhapi.com/v1/villagers/${randomVillagerId}`);
    return response.data;
  } catch (error) {
    console.error('Erreur lors de la récupération des données du villageois:', error);
    return null;
  }
}

async function afficherVillageoisDansOBS(nomVillageois, urlImage) {
  try {
    const nomScene = 'Pokemon'; // Remplacez par le nom de votre scène dans OBS pour les villageois
    const sceneItemId = 7; // Remplacez par l'ID de votre groupe d'images pour les villageois dans OBS
    const nomSourceImage = 'ImageACNH'; // Remplacez par le nom de votre source d'image pour les villageois dans OBS

    // Mettre à jour l'image de la source
    await obs.call('SetInputSettings', {
      inputName: nomSourceImage,
      inputSettings: {
        file: urlImage
      }
    });

    // Activer le groupe d'images dans OBS
    await obs.call('SetSceneItemEnabled', {
      sceneName: nomScene,
      sceneItemId: sceneItemId,
      sceneItemEnabled: true
    });

    console.log(`Villageois ${nomVillageois} affiché dans OBS`);

    // Désactiver l'affichage après 10 secondes
    setTimeout(async () => {
      await desactiverVillageoisDansOBS();
    }, 10000);

  } catch (error) {
    console.error(`Erreur lors de l'affichage du villageois ${nomVillageois} dans OBS:`, error);
  }
}

async function desactiverVillageoisDansOBS() {
  try {
    const nomScene = 'AnimalCrossing'; // Nom de votre scène dans OBS pour les villageois
    const sceneItemId = 7; // ID du groupe pour les villageois dans OBS

    // Désactiver l'élément de scène
    await obs.call('SetSceneItemEnabled', {
      sceneName: nomScene,
      sceneItemId: sceneItemId,
      sceneItemEnabled: false
    });

    console.log('Villageois désactivé dans OBS');
  } catch (error) {
    console.error('Erreur lors de la désactivation du villageois dans OBS:', error);
  }
}

async function afficherPokemonDansOBS(nomPokemon, urlImage) {
  try {
    const nomScene = 'Pokemon'; // Nom de votre scène dans OBS
    const sceneItemId = 6; // ID du groupe Pokémon dans OBS
    const nomSourceImage = 'ImagePokemon'; // Nom de la source d'image pour le Pokémon dans OBS

    // Mettre à jour l'image de la source
    await obs.call('SetInputSettings', {
      inputName: nomSourceImage,
      inputSettings: {
        file: urlImage
      }
    });

    // Activer le groupe d'images dans OBS
    await obs.call('SetSceneItemEnabled', {
      sceneName: nomScene,
      sceneItemId: sceneItemId,
      sceneItemEnabled: true
    });

    console.log(`Groupe Pokémon affiché dans OBS pour le Pokémon ${nomPokemon}`);

    // Désactiver l'affichage après 10 secondes
    setTimeout(async () => {
      await desactiverPokemonDansOBS();
      pokemonActuel = null;
    }, 10000);

  } catch (error) {
    console.error('Erreur lors de l\'affichage du Pokémon dans OBS:', error);
  }
}

async function desactiverPokemonDansOBS() {
  try {
    const nomScene = 'Pokemon'; // Nom de votre scène dans OBS
    const sceneItemId = 6; // ID du groupe Pokémon dans OBS

    // Désactiver l'élément de scène
    await obs.call('SetSceneItemEnabled', {
      sceneName: nomScene,
      sceneItemId: sceneItemId,
      sceneItemEnabled: false
    });

    console.log('Pokémon désactivé dans OBS');
  } catch (error) {
    console.error('Erreur lors de la désactivation du Pokémon dans OBS:', error);
  }
}


function mettreAJourPoints(gagnant) {
  const db = new sqlite3.Database('zamours.db');

  db.serialize(() => {
    db.get(`SELECT points FROM points WHERE username = ?`, [gagnant], (err, row) => {
      if (err) {
        console.error('Erreur lors de la récupération des points :', err);
        db.close();
        return;
      }

      if (row) {
        const pointsActuels = row.points;
        db.run(`UPDATE points SET points = ? WHERE username = ?`, [pointsActuels + 10, gagnant], (err) => {
          if (err) {
            console.error('Erreur lors de la mise à jour des points :', err);
          }
          db.close();
        });
      } else {
        db.run(`INSERT INTO points (username, points) VALUES (?, 10)`, [gagnant], (err) => {
          if (err) {
            console.error('Erreur lors de l\'insertion des points :', err);
          }
          db.close();
        });
      }
    });
  });
}

// Connexion au serveur Twitch
bot.connect();

bot.on('connected', (address, port) => {
  console.log(`Connected to ${address}:${port}`);
});

// Événement message
bot.on('message', (channel, tags, message, self) => {
  if (self) return; // Ignorer les messages du bot lui-même

  const command = message.trim().toLowerCase();

  if (message.toLowerCase() === '!invocation' && tags.username === 'oderun') {
    axios.post('http://localhost:3000/ask', { question: 'Posez votre question' })
        .then(response => {
            const reply = response.data.reply;
            bot.say(channel, reply);
        })
        .catch(error => {
            console.error('Erreur lors de l\'envoi de la question:', error);
            bot.say(channel, 'Désolé, je ne peux pas répondre en ce moment.');
        });
      } else if (command === '!new' && tags.username === 'oderun') {
    afficherPokemonAleatoire();
    if (command === '!catch') {
      const username = tags.username;
      if (pokemonActuel && points[username] >= 10 && !pokemonCapturePar[username]?.includes(pokemonActuel.id)) {
        const tauxCapture = Math.random() < 0.5; // 50% de chance de capture, ajustez comme nécessaire
        if (tauxCapture) {
          bot.say(channel, `Félicitations ${username}, tu as capturé ${pokemonActuel.nom}!`);
          points[username] -= 10; // Déduire les points
          if (!pokemonCapturePar[username]) {
            pokemonCapturePar[username] = [];
          }
          pokemonCapturePar[username].push(pokemonActuel.id); // Enregistrer la capture
          // Ajoutez ici la logique pour enregistrer la capture dans un fichier ou une base de données
        } else {
          bot.say(channel, `Dommage ${username}, ${pokemonActuel.nom} s'est échappé!`);
        }
      } else {
        bot.say(channel, `Tu ne peux pas capturer ${pokemonActuel ? pokemonActuel.nom : "ce Pokémon"}!`);
      }
    }
  } else if (command === 'commence' && tags.username === 'oderun') {
    // Démarrer la partie si "oderun" dit "commence"
    partieCommencee = true;
    motsRestants = [...motsDuJour];
    bot.say(channel, 'La partie commence ! Il y a trois mots à trouver');
  } else if (command === 'clear' && tags.username === 'oderun') {
    setTimeout(() => {
      desactiverCoeurs();
    }, 3000);
  } else if (partieCommencee && motsRestants.includes(command)) {
    // Vérifier si le mot est l'un de ceux à trouver
    bot.say(channel, `Bravo ${tags.username} ! Tu as trouvé le mot : ${command}`);
    motsRestants = motsRestants.filter((mot) => mot !== command);

    if (motsRestants.length === 0) {
      bot.say(channel, 'Félicitations ! Tous les mots ont été trouvés. Fin de la partie.');
      partieCommencee = false;
      // Réinitialiser le jeu
      questionActuelle = null;
      bonnesReponsesConsecutives = 0;
      viewerInitiateur = null;
      retournerScenePrecedente();
    }
  } else if (command === '!zamour' && viewerInitiateur === null) {
    // Vérifier si 10 minutes se sont écoulées depuis la dernière partie
    const maintenant = new Date().getTime();
    const differenceTemps = (maintenant - dernierePartieTimestamp) / (1000 * 60); // Différence en minutes

    if (joueursAyantDejaJoue.has(tags.username)) {
      bot.say(channel, `Désolé, ${tags.username}, tu as déjà joué cette session.`);
      return;
    } else if (differenceTemps >= 10) {
      // Répondre à la commande !zamour avec le pseudo de la personne qui l'a envoyée
      changerSceneZamour();
      viewerInitiateur = tags.username;
      bot.say(channel, `Ok, c'est parti pour les z'amours avec toi, ${viewerInitiateur} !`);
      fs.writeFileSync('pseudozamour.txt', viewerInitiateur);
      // Commencer le jeu des questions
      commencerJeuDesQuestions(channel);
      
      // Mettre à jour le timestamp de la dernière partie
      dernierePartieTimestamp = maintenant;
    } else {
      bot.say(channel, `Désolé, attends encore un peu avant de lancer une nouvelle partie.`);
    }
  } else if (questionActuelle && tags.username === viewerInitiateur) {
    // Vérifier la réponse à la question actuelle
    const reponseAttendue = questionActuelle.reponse.toLowerCase().trim();
    const reponseDonnee = command.toLowerCase().trim();

    if (verifierReponse(reponseDonnee, reponseAttendue)) {
      jouerSonReponseCorrecte();
      bonnesReponsesConsecutives++;
      numeroQuestionActuelle++;

      if (bonnesReponsesConsecutives >= 5) {
        bot.say(channel, `Félicitations, ${viewerInitiateur} ! Tu gagnes dix points !`);
        if (viewerInitiateur) { // Vérifier que viewerInitiateur n'est pas null
          mettreAJourPoints(viewerInitiateur);
        }
        // Réinitialiser le jeu
        joueursAyantDejaJoue.add(viewerInitiateur);
        activerGroupeVictoire();
        retournerScenePrecedente();
        questionActuelle = null;
        bonnesReponsesConsecutives = 0;
        viewerInitiateur = null; // Réinitialiser viewerInitiateur après la mise à jour des points
        echecs = 0;
        reponseCorrecte();
        reinitialiserJeu();
        setTimeout(() => {
          desactiverCoeurs();
        }, 3000);
      } else {
        reponseCorrecte();  // Assurez-vous d'avoir les parenthèses ici
        questionsRestantes = questionsRestantes.filter((q) => q !== questionActuelle);
        bot.say(channel, `Bravo ${viewerInitiateur} ! Question suivante.`);
        commencerJeuDesQuestions(channel);
      }
    } else {
      // Logique pour une réponse incorrecte...
      reponseIncorrecte();  // Masque coeurjaune1
      jouerSonReponseIncorrecte();
      echecs++;
      numeroQuestionActuelle++;

      if (echecs >= 5) {
        // Fin de la partie après 3 échecs consécutifs
        bot.say(channel, `Trop d'échecs, ${viewerInitiateur} ! Fin de la partie.`);// À la fin de la partie, après les vérifications nécessaires
        joueursAyantDejaJoue.add(viewerInitiateur);
        setTimeout(() => {
          desactiverCoeurs();
        }, 3000);
        reinitialiserJeu();
        retournerScenePrecedente();
        
        // Vider le fichier texte
        fs.writeFileSync('question.txt', '');
        fs.writeFileSync('pseudozamour.txt', '');
        // Réinitialiser les variables de jeu
        questionActuelle = null;
        bonnesReponsesConsecutives = 0;
        viewerInitiateur = null;
        echecs = 0; // Réinitialise le nombre d'échecs
      } else {
        bot.say(channel, `Dommage ${viewerInitiateur} ! Mauvaise réponse !`);
        commencerJeuDesQuestions(channel);  // Appeler la fonction pour la nouvelle question
      }
    }
  } 
});
/*
  } else if (command.startsWith('!ajout')) {
    const participant = command.replace('!ajout', '').trim();
    if (!participants.includes(participant)) {
      participants.push(participant);
      bot.say(channel, `${participant} a été ajouté à la liste des merdes de ce zapping.`);
      contributions[userstate.username] = (contributions[userstate.username] || 0) + 1;
      totalParticipants = participants.length; // Mettez à jour le nombre total
      updateOverlay(); // Appel de la fonction pour mettre à jour l'overlay
    } else {
      bot.say(channel, `Pas possible, ${participant} est déjà dans la liste des merdes.`);
    }
  } else if (userstate.username === 'oderun' && command.startsWith('@botququ -')) {
    const participantToRemove = command.replace('@botququ -', '').trim();
    const indexToRemove = participants.indexOf(participantToRemove);

    if (indexToRemove !== -1) {
      participants.splice(indexToRemove, 1);
      bot.say(channel, `${participantToRemove} a été retiré de la liste des merdes de l'année.`);
      totalParticipants = participants.length; // Mettez à jour le nombre total
      updateOverlay(); // Appel de la fonction pour mettre à jour l'overlay
    } else {
      bot.say(channel, `${participantToRemove} n'est pas dans la liste des merdes de l'année (mais il viendra sans doute).`);
    }
  } else if (command.toLowerCase() === '!liste') {
    const totalParticipants = participants.length;
    const listMessage = participants.map((participant, index) => `${index + 1} - ${participant}`).join(', ');
    bot.say(channel, 'Début de liste : 1 - PPDA, 2 - jospin, 3 - Chirac, 4 - bernadette, 5 - Barre, 6 - debré, 7 - Hulot, 8 - Putin, 9 - Castro, 10 - Clinton, 11 - JP2, 12 - David Douillet, 13 - Reichmann, 14 - Delon, 15 - Lalanne, 16 - Gainsbourg, 17 - JMLP, 18 - Bernard Tapis, 19 - Clavier, 20 - Saddam Hussein, 21 - Bush père, 22 - Bruel, 23 - Les Musclés, 24 - Palmade, 25 - F Miterrand, 26 - Dufoix');
    bot.say(channel, `Liste des merdes (${totalParticipants} personnes) : ${listMessage}`);
  } else if (command.startsWith('!1995')) {
    bot.say(channel, `Les merdes de l'année 95 : 1-Tapie, 2-PPDA, 3-Chirac, 4-Balkany, 5-Sarkozy, 6-Juppé, 7-Barre, 8-Pasqua, 9-Hallier, 10-JM LePen, 11-Morandini, 12-Hulot, 13-Clinton, 14-Cantonna, 15-Baffie, 16-Allen`);
  } else if (command.startsWith('!2007')) {
    bot.say(channel, `Les merdes de l'année 2007 : 1-Finkielkraut, 2-Sardou, 3-M LePen, 4-Zemmour, 5-Sarkozy, 6-Hulot, 7-Chirac, 8-Fillon, 9-Morano, 10-Bayrou, 11-Fogiel, 12-JM LePen, 13-Gollnish, 14-PPDA, 15-Courbet, 16-Strauss-Khan`);
    bot.say(channel, `17-Delarue, 18-Cauet, 19-Morandini, 20-Tex, 21-Bigard, 22-Villepin, 23-Johnny, 24-Putin, 25-Claude François, 26-Pécresse, 27-Castaldi, 28-De Fontenay, 29-Bush Père, 30-Bush Fils, 31-Ben Laden, 32-Cahuzac, 33-Ardisson`);
    bot.say(channel, `34-Pasqua, 35-James Watson, 36-Jimi Hendrix, 37-Karl Lagerfeld, 38-Lagarde, 40-Marc Lavoine, 41-Naulleau, 42-Boutin, 43-Gilbert Rozon, 44-Barbier, 45-Mao, 46-Khadafi, 47-Lepers, 48-Arthus Bertrand`);
  } else if (command.startsWith('!1994')) {
    bot.say(channel, `Les merdes de l'année 94: 1-Hulot, 2-Delarue, 3-Cauet, 4-Bruni, 5-Mobutu, 6-Bongo, 7-Tyson, 8-PPDA, 9-Chirac, 10-Sarkozy, 11-Balladur, 12-Tapie, 13-Mitterand, 14-Pasqua, 15-JM LePen, 16-De Villiers, 17-Tarantino, 18-Morandini, 19-Dali, 20-Depardieu, 21-Mitterand, 22-Johnny, 23-Berlusconi`);
  } else if (command.startsWith('!1999')) {
    bot.say(channel, `On a pas pensé à sauvegarder ces informations, désolé :/ Mais j'imagine qu'il y avait Sarkozy et Balkany`);
  } else if (command.startsWith('!2005')) {
    bot.say(channel, `On a pas pensé à sauvegarder ces informations, désolé :/ Mais j'imagine qu'il y avait Chirac et PPDA`);
  } else if (command.startsWith('!contributeur')) {
    // Affichage des contributions
    const contributors = Object.entries(contributions)
      .map(([contributor, count]) => `${contributor} - ${count} ajout${count !== 1 ? 's' : ''}`)
      .join(', ');

    bot.say(channel, `Contributeurs : ${contributors}`);
  } else if (command.toLowerCase() === '!commandes') {
    bot.say(channel, "!année => Pour savoir les années que l'on a traité, !ajout => Pour ajouter une merde à ce zapping, !liste => pour avoir la liste des merdes de ce zapping, !contributeur => Pour savoir qui a listé les merdes de ce zapping")
  } else if (command.toLowerCase() === '!années') {
    bot.say(channel, "!1995, !2007, !1994, !1999, !2005, !liste (pour celle dont on s'occupe actuellement)")
  */