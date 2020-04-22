const SerialPort = require('serialport');
const Readline = require('@serialport/parser-readline');
const consoleReadLine = require('readline');
const haversine = require('haversine');
// const colors = require('colors');
const math = require('mathjs');
const fs = require('fs');
const endOfLine = require('os').EOL;
const sleep = (waitTimeInMs) => new Promise(resolve => setTimeout(resolve, waitTimeInMs));

const _BAUD = 115200;

async function main() {
   let selectedPort;
   const logFile = getLogFilename();
   while(true) {
      try {
         let portFound = false;
         if (selectedPort) {
            for (let retry=0; retry < 10; retry++) {
               await sleep(500);
               await SerialPort.list().then((ports) => {
                  for (let port of ports) {
                     if (port.comName == selectedPort.comName) {
                        portFound = true;
                        break;
                     }
                  }
               }).catch(() => {
                  portFound = false;
               })
            }
         }
         let retry = true;
         let first = true;
         let wait = true;
         while (retry) {
            if (portFound) {
               retry = false;
               break;
            }
            await SerialPort.list((err, ports) => {
               if (err) {
                  console.log('Error! ', err);
                  process.exit(-1);
               }
               if (ports.length == 0) {
                  if (first) {
                     console.log("No available ports found. Waiting for device to connect...");
                     first = false;
                  }
                  wait = false;
               } else if (ports.length == 1) {
                  selectedPort = ports[0];
                  wait = false;
                  retry = false;
               } else {
                  console.log("Available ports:");
                  ports.forEach((port) => {
                     console.log(port.comName);
                  });
                  const rl = consoleReadLine.createInterface({
                     input: process.stdin,
                     output: process.stdout
                  });
                  console.log("Enter selected port: ");
                  rl.prompt();
                  rl.on('line', (answer) => {
                     ports.forEach((port) => {
                        if (answer.trim() == port.comName) {
                           wait = false;
                           retry = false;
                           selectedPort = port;
                        }
                     });
                     if (retry) {
                        console.log('Invalid choice, please try again.');
                        console.log("Enter selected port: ");
                        rl.prompt();
                     }
                  });
               }
            });
            while (wait) {
               await sleep(1000);   
            }
            if (retry) {
               await sleep(1000);   
            } else {
               const port = new SerialPort(selectedPort.comName, { baudRate: _BAUD }, (err) => {
                  if (err != null && err != undefined) {
                     console.error('Error opening port: ' + err);
                     retry = true;
                  }
               });
               const parser = port.pipe(new Readline({ delimiter: '\n' }));
               // Read the port data
               port.on("open", () => {
                 console.log('Serial port open (' + selectedPort.comName + ')');
               });
               port.on("close", () => {
                  console.log('Serial port closed!');
                  retry = true;
               });
               let remoteLat;
               let remoteLong;
               let localLat;
               let localLong;
               parser.on('data', data =>{
                  if (data.trim().length == 0) {
                     return;
                  }
                  if (data.startsWith("REMOTE:")) {
                     let relevantData = data.replace('REMOTE:', '');
                     let logData = "Remote coordinates:" + relevantData;
                     console.log(logData);
                     dataLog(logData, logFile);
                     let parts = relevantData.split(',');
                     remoteLat = parts[0].trim();
                     remoteLong = parts[1].trim();
                  } else if (data.startsWith("LOCAL:")) {
                     let relevantData = data.replace('LOCAL:', '');
                     let logData = "Local coordinates:" + relevantData;
                     console.log(logData);
                     dataLog(logData, logFile);
                     let parts = relevantData.split(',');
                     localLat = parts[0].trim();
                     localLong = parts[1].trim();
                     if (remoteLat && remoteLong && localLat && localLong) {
                        let direction = getDirection(remoteLat - localLat, remoteLong - localLong);
                        let dist = 'Computed distance: ' + computeDistance(localLat, localLong, remoteLat, remoteLong) + ' meters ' + direction;
                        console.log("\n", dist, "\n");
                        dataLog(dist, logFile);
                        // console.log('Computed distance: ', distanceInKmBetweenEarthCoordinates(localLat, localLong, remoteLat, remoteLong, {unit: 'meter'}), ' meters');
                     }
                  } else {
                     if (!data.startsWith('Distance:')) {
                        let logData = 'Control message: ' + data;
                        console.log(logData);
                        dataLog(logData, logFile);
                     }
                  }
               });
            }
         }
         
         while (!retry) {
            await sleep(1000);   
         }

      } catch (err) {
         console.error('Unexpected error: ', err);
      }
   }
}
main();
function computeDistance(currentLat, currentLong, otherLat, otherLong) {
   const start = {
      latitude: currentLat,
      longitude: currentLong
    }
    
    const end = {
      latitude: otherLat,
      longitude: otherLong
    }
    
    return Math.round(haversine(start, end, {unit: 'meter'}))
}

function distanceInKmBetweenEarthCoordinates(lat1, lon1, lat2, lon2) {
   var earthRadiusKm = 6371;
 
   var dLat = degreesToRadians(lat2-lat1);
   var dLon = degreesToRadians(lon2-lon1);
 
   lat1 = degreesToRadians(lat1);
   lat2 = degreesToRadians(lat2);
 
   var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
           Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2); 
   var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
   return earthRadiusKm * c;
 }

 function getDirection(vectorLatitude, vectorLongitude)
 {
    let compass = ((math.round(math.atan2(vectorLatitude, vectorLongitude) / (2 * math.pi / 8))) + 8) % 8;
    switch (compass)
    {
    case 0:
       return "East";
    case 1:
       return "Northeast";
    case 2:
       return "North";
    case 3:
       return "Northwest";
    case 4:
       return "West";
    case 5:
       return "Southwest";
    case 6:
       return "South";
    default:
       return "Southeast";
    }
 }

 function dataLog(data, logFile) {
   try {
      if (!data.endsWith(endOfLine)) {
         data += endOfLine;
      }
      fs.appendFileSync(logFile, '[' + new Date().toLocaleString() + '] ' + data);
   } catch (err) {
      let msg = 'Error writing to log file: ' + err;
      console.error(msg.bgRed);
   }
 }

 function getLogFilename() {
    let ext = '.log'
    if (!fs.existsSync('data' + ext)) {
       return 'data.log';
    }
    let counter = 1;
    let filename = 'data' + counter + ext;
    while (fs.existsSync(filename)) {
       filename = 'data' + (++counter) + ext;
    }
    return filename;
 }