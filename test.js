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
const TEMPS_ATTENTE_QPUC = 60; // 60 secondes pour rejoindre le jeu
const TEMPS_REPONSE_QUESTION = 20; // 20 secondes pour répondre à une question
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
const avatars = ['Artemis', 'Garnet', 'Janet', 'Shiva', 'BruceLee', 'GustavoFring', 'Kratos', 'Kronk', 'KylianMBappe', 'MuhammadAli', 'NikosAliagas', 'Obelix&Idefix', 'PhilippePoutou', 'Toad', 'TomNook', 'Aerith', 'Buffy', 'ChunLi', 'Connie', 'CouetteCouette', 'Daphne', 'FranFine', 'Mulan', 'Pecresse', 'Thatcher', 'Whoopie'];

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
const questions = require('./questionsZAmour.js');
const questionsCultureGenerale = require('./questionsQPUC.js');


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
let qpucEnCours = false;
let participantsQPUC = new Set();
let timerQPUC = null;
let nombreDeParticipants = 0;
let scores = {};
let timerQuestion = null;
let zamourEnCours = false;
let scenePrecedenteQPUC;
let timerDebutQPUC = null; // Timestamp pour le début de l'attente de QPUC
let timerDebutQuestion = null; // Timestamp pour le début d'une question
let etatQPUC = 'attente';
let tempsRestantQPUC;
let questionEnCours = false;

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

function traiterReponses(channel, tags, message) {
  if (zamourEnCours && viewerInitiateur === tags.username) {
      // Appeler la fonction de vérification pour Les Z'amours
      verifierReponseZamour(message, channel);
  } else if (qpucEnCours) {
      // Appeler la fonction de vérification pour QPUC
      verifierReponseQPUC(message, channel, tags.username);
  }
}

function verifierReponseZamour(reponseDonnee, channel) {
  // Assurez-vous que la question actuelle est définie
  if (!questionActuelle) return;

  const reponseAttendue = questionActuelle.reponse.toLowerCase().trim();
  if (verifierCorrespondanceReponse(reponseDonnee.toLowerCase().trim(), reponseAttendue)) {
      // Logique pour une réponse correcte
      bot.say(channel, `Bonne réponse !`);
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
      // Logique pour une réponse incorrecte
      bot.say(channel, `Mauvaise réponse.`);
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

function verifierReponseQPUC(reponseDonnee, channel, username) {
  if (!questionActuelle) return;

  const reponseAttendue = questionActuelle.reponse.toLowerCase().trim();
  if (verifierReponse(reponseDonnee.toLowerCase().trim(), reponseAttendue)) {
      clearTimeout(timerQuestion);
      bot.say(channel, `Bonne réponse de ${username} ! La réponse était : ${questionActuelle.reponse}`);
      scores[username] = (scores[username] || 0) + questionActuelle.points;
      mettreAJourPointsJoueur(username, scores[username]);

      questionEnCours = false; // Réinitialiser questionEnCours

      if (scores[username] >= 10) {
          bot.say(channel, `${username} a gagné avec 10 points !`);
          finDePartieQPUC();
      } else {
          poserQuestion(channel); // Poser la question suivante
      }
  }
}

function desactiverTousLesAvatarsQPUC() {
  participantsQPUC.forEach(username => {
    desactiverAvatarPourParticipant(username);
  });
}

function finDePartieQPUC() {
  qpucEnCours = false;
  questionEnCours = false;
  annulerQPUC();
  retournerScenePrecedenteQPUC();
  // desactiverTousLesAvatarsQPUC();
  desactiverTousLesAvatars();
  let etatQPUC = 'attente';
}

function desactiverAvatarPourParticipant(username) {
  const index = Array.from(participantsQPUC).indexOf(username);
  if (index !== -1) {
    const suffixes = ['EG', 'G', 'D', 'ED'];
    const suffixe = suffixes[index];
    const avatarChoisi = avatars[Math.floor(Math.random() * avatars.length)]; // Ou une autre logique pour déterminer l'avatar
    const nomAvatar = avatarChoisi + suffixe;
    desactiverAvatarDansOBS(nomAvatar);
  }
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

/* ******************************
*********************************
*********************************
*********************************
QPUC A PARTIR DE ICI //
*********************************
*********************************
*********************************
*/
function mettreAJourPointsJoueur(username, points) {
    // Trouver l'index du joueur dans la liste des participants
    const index = Array.from(participantsQPUC).indexOf(username);
    if (index !== -1) {
        const fichier = `pointqpuc${index + 1}.txt`;
        fs.writeFileSync(fichier, points.toString());
    }
}

function changerSceneQPUC() {
  obs.call('SetCurrentProgramScene', {
    'sceneName': 'QPUC' // Remplacez par le nom de votre scène QPUC dans OBS
  }).then(() => {
    console.log('Scène changée en QPUC');
    ecrireNomsParticipants(); // Appeler la fonction pour écrire les noms dans les fichiers
  }).catch(err => {
    console.error('Erreur lors du changement de scène:', err);
  });
}

function ecrireNomsParticipants() {
  const participantsArray = Array.from(participantsQPUC);
  console.log("Écriture des noms des participants dans les fichiers");

  for (let i = 0; i < participantsArray.length && i < 4; i++) {
    const filePath = `candidat${i + 1}.txt`;
    const participantName = participantsArray[i];

    fs.writeFile(filePath, participantName, (err) => {
      if (err) {
        console.error(`Erreur lors de l'écriture du fichier ${filePath}:`, err);
      } else {
        console.log(`Nom du participant écrit dans ${filePath}: ${participantName}`);
      }
    });
  }
}

function lancerQPUC(channel) {
  qpucEnCours = true;
  questionEnCours = false;
  scores = {};
  participantsQPUC.forEach((username, index) => {
      scores[username] = 0;
      fs.writeFileSync(`pointqpuc${index + 1}.txt`, '0');
  });
    timerDebutQPUC = Date.now();
    poserQuestion(channel);
    if (!timerQuestion) { // Vérifiez si le timer de question n'est pas déjà en cours
      poserQuestion(channel);
  }
}

function poserQuestion(channel) {
  if (questionEnCours || !qpucEnCours) {
    return;
  }

  questionEnCours = true;
  if (timerQuestion) {
    clearTimeout(timerQuestion);
  }

  etatQPUC = 'question';
  console.log("Poser question appelée pour le canal: " + channel);
  questionActuelle = questionsCultureGenerale[Math.floor(Math.random() * questionsCultureGenerale.length)];
  console.log("Question actuelle: " + questionActuelle.question);
  timerDebutQuestion = Date.now();

  bot.say(channel, `Question (${questionActuelle.points} points) : ${questionActuelle.question}`).then(() => {
    console.log("Message envoyé avec succès");
  }).catch(e => {
      console.error("Erreur lors de l'envoi du message", e);
  });

  fs.writeFileSync('qpucMessage.txt', questionActuelle.question); // Écrit la question dans le fichier

  timerQuestion = setTimeout(() => {
    questionActuelle = null;
    bot.say(channel, "Temps écoulé ! Question suivante.");
    questionEnCours = false; // Réinitialiser le verrouillage
    if (qpucEnCours) {
      poserQuestion(channel);
    }
  }, TEMPS_REPONSE_QUESTION * 1000);
}

function verifierEtLancerQPUC(channel) {
  if (participantsQPUC.size >= 4) {
    qpucEnCours = true;
    bot.say(channel, `Début du jeu QPUC avec les participants : ${Array.from(participantsQPUC).join(', ')}`);
    changerSceneQPUC(); // Changer la scène si le nombre de participants est suffisant
  }
}

function attribuerEtActiverAvatarPourParticipant(username) {
  const suffixes = ['EG', 'G', 'D', 'ED'];
  if (nombreDeParticipants < suffixes.length) {
    const avatarChoisi = avatars[Math.floor(Math.random() * avatars.length)];
    const suffixe = suffixes[nombreDeParticipants];
    const nomAvatar = avatarChoisi + suffixe;
    activerAvatarDansOBS(nomAvatar);
    nombreDeParticipants++;
  } else {
    console.log('Nombre maximum de participants atteint.');
  }
}

function demarrerTimerQPUC(duree, channel, pourQuestions = false) {
  tempsRestantQPUC = duree;
  timerQPUC = setInterval(() => {
      if (tempsRestantQPUC > 0) {
          tempsRestantQPUC--;
          fs.writeFileSync('timerqpuc.txt', tempsRestantQPUC.toString());
      } else {
          clearInterval(timerQPUC);
          fs.writeFileSync('timerqpuc.txt', '');
          if (pourQuestions) {
              // Ici, ajoutez la logique à exécuter à la fin du timer des questions
              // Par exemple, passer à la question suivante
              poserQuestion(channel);
          } 
      }
  }, 1000);
}


async function getSceneItemId(sceneName, sourceName) {
  try {
    const response = await obs.call('GetSceneItemList', { sceneName });
    const sceneItem = response.sceneItems.find(item => item.sourceName === sourceName);
    return sceneItem ? sceneItem.sceneItemId : null;
  } catch (error) {
    console.error('Erreur lors de la récupération de sceneItemId:', error);
    return null;
  }
}

async function activerAvatarDansOBS(nomAvatar) {
  const sceneItemId = await getSceneItemId('QPUC', nomAvatar);
  if (sceneItemId) {
    obs.call('SetSceneItemEnabled', {
      'sceneName': 'QPUC',
      'sceneItemId': sceneItemId,
      'sceneItemEnabled': true
    }).then(() => {
      console.log(`Avatar ${nomAvatar} activé dans OBS`);
    }).catch(err => {
      console.error(`Erreur lors de l'activation de l'avatar ${nomAvatar} dans OBS:`, err);
    });
  } else {
    console.error(`sceneItemId introuvable pour ${nomAvatar}`);
  }
}

function attribuerEtActiverAvatarPourJoueur1() {
  const avatarChoisi = avatars[Math.floor(Math.random() * avatars.length)];
  const nomAvatar = avatarChoisi + 'EG'; // EG pour le joueur 1
  activerAvatarDansOBS(nomAvatar);
}

function annulerQPUC() {
  // Désactiver les avatars, effacer les pseudos, réinitialiser les scores...
  participantsQPUC.clear();
  qpucEnCours = false;
  // Ajoutez le code nécessaire ici
}

function changerSceneQPUC() {
  obs.call('GetCurrentProgramScene').then(response => {
    scenePrecedenteQPUC = response.currentProgramSceneName;
    obs.call('SetCurrentProgramScene', {
      'sceneName': 'QPUC' // Nom de la scène QPUC
    }).then(() => {
      console.log('Scène changée en QPUC');
      ecrireNomsParticipants();
      // autres actions nécessaires
    }).catch(err => {
      console.error('Erreur lors du changement de scène:', err);
    });
  }).catch(err => {
    console.error('Erreur lors de la récupération de la scène actuelle:', err);
  });
}

function retournerScenePrecedenteQPUC() {
  // Attendre 5 secondes avant de changer de scène
  setTimeout(() => {
    if (scenePrecedenteQPUC) {
      obs.call('SetCurrentProgramScene', {
        'sceneName': scenePrecedenteQPUC
      }).catch(err => {
        console.error('Erreur lors du retour à la scène précédente:', err);
      });
    }
  }, 5000); // Délai de 5 secondes (5000 millisecondes)
}

function ecrireMessageAttente() {
  fs.writeFileSync('qpucMessage.txt', 'En attente de participants, tape !participe pour rejoindre le lobby !');
}

function reinitialiserQPUC() {
  participantsQPUC.clear();
  qpucEnCours = false;
  clearTimeout(timerQPUC); // Assurez-vous d'annuler le timer en cours si nécessaire
  // Autres réinitialisations si nécessaire...

  // Réécrire le message d'attente après un délai
  setTimeout(ecrireMessageAttente, 10000);
}

function miseAJourTimerQPUC() {
  let tempsRestant;

  if (etatQPUC === 'attente') {
      // Temps restant avant le début du jeu QPUC
      tempsRestant = TEMPS_ATTENTE_QPUC - Math.floor((Date.now() - timerDebutQPUC) / 1000);
      if (tempsRestant <= 0) {
          // Commencer les questions QPUC
          etatQPUC = 'question';
      }
  } else if (etatQPUC === 'question') {
      // Temps restant pour répondre à la question en cours
      tempsRestant = TEMPS_REPONSE_QUESTION - Math.floor((Date.now() - timerDebutQuestion) / 1000);
      if (tempsRestant <= 0) {
      }
  }
  tempsRestant = Math.max(0, tempsRestant); // Éviter les temps négatifs
  fs.writeFileSync('timerqpuc.txt', tempsRestant.toString());
}
// Appeler cette fonction régulièrement, par exemple toutes les secondes
setInterval(miseAJourTimerQPUC, 100);

function desactiverTousLesAvatars() {
  setTimeout(() => {
      const suffixes = ['EG', 'G', 'D', 'ED'];
      avatars.forEach(avatar => {
          suffixes.forEach(suffix => {
              const nomAvatar = avatar + suffix;
              desactiverAvatarDansOBS(nomAvatar);
          });
      });
      participantsQPUC.clear();
  }, 5000);
}
  
  async function desactiverAvatarDansOBS(nomAvatar) {
    const sceneItemId = await getSceneItemId('QPUC', nomAvatar);
    if (sceneItemId) {
      obs.call('SetSceneItemEnabled', {
        'sceneName': 'QPUC',
        'sceneItemId': sceneItemId,
        'sceneItemEnabled': false
      }).catch(err => {
        console.error(`Erreur lors de la désactivation de l'avatar ${nomAvatar} dans OBS:`, err);
      });
    }
  }

//////////////////////////////////////////////
//////////////////////////////////////////////
//////////////////////////////////////////////
//////////////////////////////////////////////
//////////////////////////////////////////////
//////////////////////////////////////////////
//////////////////////////////////////////////
//////////////////////////////////////////////
bot.connect();

bot.on('connected', (address, port) => {
  console.log(`Connected to ${address}:${port}`);
});

bot.on('message', (channel, tags, message, self) => {
    if (self) return;
      console.log(`Message reçu: ${message}`);

  const command = message.trim().toLowerCase();

  if (command === '!participe') {
    if (qpucEnCours && participantsQPUC.size < 4) {
      if (!participantsQPUC.has(tags.username)) {
        participantsQPUC.add(tags.username);
        bot.say(channel, `${tags.username} a rejoint QPUC!`);
        ecrireNomsParticipants(); // Mettre à jour les noms des participants
        attribuerEtActiverAvatarPourParticipant(tags.username);
      } else {
        bot.say(channel, `${tags.username}, tu es déjà inscrit à QPUC, tu as une mémoire extrêmement courte`);
      }
    } else {
      bot.say(channel, `Désolé, ${tags.username}, tu ne peux pas rejoindre QPUC en ce moment, on est trop nombreux.`);
    }
  }

  traiterReponses(channel, tags, message);
  
  switch (command) {
    case '!qpuc':
      fs.writeFileSync('pointqpuc1.txt', "");
      fs.writeFileSync('pointqpuc2.txt', "");
      fs.writeFileSync('pointqpuc3.txt', "");
      fs.writeFileSync('pointqpuc4.txt', "");
      fs.writeFileSync('qpucMessage.txt', 'Départ du jeu dans moins d\'une minute, faites !participe pour rejoindre le lobby');
      if (zamourEnCours) {
        bot.say(channel, "Le jeu des Z'amours est en cours. Veuillez attendre la fin de cette partie pour lancer QPUC.");
      } else if (!qpucEnCours) {
        demarrerTimerQPUC(60, channel);
        qpucEnCours = true;
        changerSceneQPUC();
        participantsQPUC.clear();
        participantsQPUC.add(tags.username); // Ajouter l'initiateur comme participant
        ecrireNomsParticipants();
        attribuerEtActiverAvatarPourJoueur1();

        bot.say(channel, "Jeu Question pour un Champion lancé ! Tapez !participe pour rejoindre. Vous avez 60 secondes.");

        // Timer de 60 secondes pour rejoindre
        timerQPUC = setTimeout(() => {
          if (participantsQPUC.size >= 1) { // Minimum 4 participants
            bot.say(channel, `Le jeu commence avec les participants : ${Array.from(participantsQPUC).join(', ')}`);
            verifierEtLancerQPUC(channel);
            lancerQPUC(channel);
          } else {
            bot.say(channel, "Pas assez de participants pour commencer le jeu.");
            qpucEnCours = false;
            retournerScenePrecedenteQPUC();
          }
        }, 60000); // changer pour 60000
      }
      break;

    case '!zamour':
        if (viewerInitiateur === null) {
          // Vérifier si 10 minutes se sont écoulées depuis la dernière partie
          if (qpucEnCours) {
            bot.say(channel, "Le jeu Question pour un Champion est en cours. Veuillez attendre la fin de cette partie pour lancer les Z'amours.");
          } else if (!zamourEnCours) {
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
      
          }
        }
          break;

        default:

        break;
      }
    });