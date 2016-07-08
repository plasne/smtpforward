var config = require("config");
var helper = require("sendgrid").mail;
var api = config.get("api");
var sg = require("sendgrid").SendGrid(api);
var SMTPServer = require("smtp-server").SMTPServer;

function parseAddresses(addresses) {
  var parsed = [];
  var comma = addresses.split(",");
  comma.forEach(function(entry) {
    var enc = entry.split("<");
    var name = enc[0].trim();
    var address = enc[1].split(">")[0].trim();
    parsed.push(new helper.Email(address, name));
  });
  return parsed;
}

// start-up the SMTP server (no authentication)
var server = new SMTPServer({
  secure: false,
  disabledCommands: ["AUTH"],
  onData: function(stream, session, callback) {
    var buffer = "";

    // parse a message as it is received
    stream.setEncoding("utf8");
    stream.on("data", function(part) {
      buffer += part;
    });

    // message fully received
    stream.on("end", function() {

      // obtain commands and lines of text from the data block
      var from, to = [], cc = [], bcc = [], subject = "", contentType = "text/plain", body = [];
      buffer.split("\n").forEach(function(line) {
        var isCmd = false;
        var a_line = line.split(":");
        if (a_line.length == 2) {
          switch(a_line[0].toLowerCase()) {
            case "subject":
              subject = a_line[1].trim();
              isCmd = true;
              break;
            case "content-type":
              if (a_line[1].toLowerCase().indexOf("html") > -1) {
                contentType = "text/html";
              }
              isCmd = true;
              break;
            case "from":
              var addresses = parseAddresses(a_line[1]);
              if (addresses.length == 1) {
                from = addresses[0];
              }
              isCmd = true;
              break;
            case "to":
              to = parseAddresses(a_line[1]);
              isCmd = true;
              break;
            case "cc":
              cc = parseAddresses(a_line[1]);
              isCmd = true;
              break;
            case "bcc":
              bcc = parseAddresses(a_line[1]);
              isCmd = true;
              break;
            case "mime-version":
            case "content-transfer-encoding":
              // commands to ignore
              isCmd = true;
              break;
            default:
              console.log("unrecognized command?: " + a_line[0]);
              break;
          }
        }
        if (!isCmd) {
          body.push(line);
        }
      });

      // allow it to send based on headers even if there aren't lines for From and To
      if (!from) {
        from = new helper.Email(session.envelope.mailFrom.address);
      }
      if (to.length < 1) {
        session.envelope.rcptTo.forEach(function(rcptTo) {
          to.push(new helper.Email(rcptTo.address));
        });
      }

      // format the mail to SendGrid
      mail = new helper.Mail();
      mail.setFrom(new helper.Email(session.envelope.mailFrom.address));
      personalization = new helper.Personalization();
      to.forEach(function(address) {
        personalization.addTo(address);
      });
      cc.forEach(function(address) {
        personalization.addCc(address);
      });
      bcc.forEach(function(address) {
        personalization.addBcc(address);
      });
      personalization.setSubject(subject);
      mail.addPersonalization(personalization);
      var content = new helper.Content(contentType, body.join("\n"));
      mail.addContent(content);

      // send the mail to SendGrid
      var requestBody = mail.toJSON();
      var request = sg.emptyRequest();
      request.method = 'POST';
      request.path = '/v3/mail/send';
      request.body = requestBody;
      sg.API(request, function (response) {
        if (response.statusCode == 202) {
          console.log("forwarded: " + to[0].email + ", " + subject);
        }
      });

      callback();
    });

  }
});
server.listen(25);
console.log("SMTP Forward listening on port 25 for SMTP traffic.");
