package com.courtside.ai.service;

import com.courtside.ai.dto.ScheduleConfig;
import com.courtside.ai.dto.SchedulePromptRequest;
import com.courtside.ai.dto.SchedulePromptResponse;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;

import static org.springframework.http.HttpStatus.BAD_GATEWAY;

@Service
public class SchedulePromptService {

  private final LlmClient llmClient;
  private final ObjectMapper objectMapper;

  public SchedulePromptService(LlmClient llmClient, ObjectMapper objectMapper) {
    this.llmClient = llmClient;
    this.objectMapper = objectMapper;
  }

  public SchedulePromptResponse extractSchedule(SchedulePromptRequest request) {
    ScheduleConfig current = request.currentConfig();
    List<String> names = request.currentPlayerNames() == null ? List.of() : request.currentPlayerNames();

    String prompt = """
        Convert the user's badminton scheduling request into JSON only.
        The app schedules doubles badminton matches.

        Rules:
        - numPlayers must be an integer from 4 to 40.
        - durationValue must be a positive integer.
        - durationUnit must be "hrs" or "min".
        - gamePoint must be 15 or 21.
        - matchCount must be a positive integer from 1 to 50.
        - playerNames should contain only explicit names from the user, or fallback names if already present.
        - Generate the requested doubles matches in the matches array.
        - Use player IDs p1, p2, p3, etc. in the same order as playerNames.
        - Each match must have exactly 2 players on sideA and exactly 2 players on sideB.
        - Balance total matches per player, rest, partner variety, and opponent variety as evenly as possible.
        - matchMinutes should fit the total duration across all matches with about 3 minutes transition between matches.
        - startMin and endMin are minute offsets from session start.
        - If a value is missing, use the current config.
        - If still unknown, use: 6 players, 2 hrs, 21 points, 6 matches.
        - Return no markdown and no explanation outside JSON.

        JSON shape:
        {
          "numPlayers": 6,
          "durationValue": 2,
          "durationUnit": "hrs",
          "gamePoint": 21,
          "matchCount": 6,
          "matchMinutes": 15,
          "playerNames": ["Raj", "Udit"],
          "matches": [
            {
              "id": "m1",
              "sideA": { "playerIds": ["p1", "p2"], "label": "Raj & Udit" },
              "sideB": { "playerIds": ["p3", "p4"], "label": "Player 3 & Player 4" },
              "winnerSide": null,
              "startMin": 0,
              "endMin": 15
            }
          ],
          "balanceStats": {
            "totalMatches": 6,
            "minMatches": 4,
            "maxMatches": 4,
            "minRest": 0,
            "maxRest": 1,
            "perfectBalance": true
          },
          "warning": null,
          "note": "Brief note about assumptions."
        }

        Current config:
        %s

        Current player names:
        %s

        User request:
        %s
        """.formatted(toJson(current), toJson(names), request.prompt().trim());

    String raw = llmClient.generateJson(prompt, "You extract scheduling settings and return valid JSON only.");
    return sanitize(parse(raw));
  }

  private SchedulePromptResponse parse(String raw) {
    try {
      JsonNode root = objectMapper.readTree(extractJson(raw));
      if (root.has("schedule")) {
        root = root.get("schedule");
      }
      List<String> playerNames = new ArrayList<>();
      JsonNode namesNode = root.get("playerNames");
      if (namesNode != null && namesNode.isArray()) {
        for (JsonNode name : namesNode) {
          if (name.isTextual() && !name.asText().isBlank()) {
            playerNames.add(name.asText().trim());
          }
        }
      }

      return new SchedulePromptResponse(
          intOrNull(root.get("numPlayers")),
          intOrNull(root.get("durationValue")),
          textOrNull(root.get("durationUnit")),
          intOrNull(root.get("gamePoint")),
          intOrNull(root.get("matchCount")),
          intOrNull(root.get("matchMinutes")),
          playerNames,
          root.get("matches"),
          root.get("balanceStats"),
          textOrNull(root.get("warning")),
          textOrNull(root.get("note"))
      );
    } catch (Exception e) {
      throw new ResponseStatusException(BAD_GATEWAY, "Could not parse schedule prompt response.", e);
    }
  }

  private SchedulePromptResponse sanitize(SchedulePromptResponse response) {
    int numPlayers = clamp(defaultInt(response.numPlayers(), 6), 4, 40);
    int durationValue = clamp(defaultInt(response.durationValue(), 2), 1, 24 * 60);
    String durationUnit = "min".equals(response.durationUnit()) ? "min" : "hrs";
    int gamePoint = response.gamePoint() != null && response.gamePoint() == 15 ? 15 : 21;
    int matchCount = clamp(defaultInt(response.matchCount(), 6), 1, 50);
    int matchMinutes = clamp(defaultInt(response.matchMinutes(), 15), 1, 24 * 60);

    List<String> names = response.playerNames() == null ? List.of() : response.playerNames().stream()
        .filter(name -> name != null && !name.isBlank())
        .map(String::trim)
        .limit(numPlayers)
        .toList();

    return new SchedulePromptResponse(
        numPlayers,
        durationValue,
        durationUnit,
        gamePoint,
        matchCount,
        matchMinutes,
        names,
        response.matches(),
        response.balanceStats(),
        response.warning(),
        response.note()
    );
  }

  private String extractJson(String raw) {
    String text = raw == null ? "" : raw.trim();
    int start = text.indexOf('{');
    int end = text.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new IllegalArgumentException("No JSON object found.");
    }
    return text.substring(start, end + 1);
  }

  private Integer intOrNull(JsonNode node) {
    return node != null && node.canConvertToInt() ? node.asInt() : null;
  }

  private String textOrNull(JsonNode node) {
    return node != null && node.isTextual() ? node.asText() : null;
  }

  private int defaultInt(Integer value, int fallback) {
    return value == null ? fallback : value;
  }

  private int clamp(int value, int min, int max) {
    return Math.max(min, Math.min(max, value));
  }

  private String toJson(Object value) {
    try {
      return objectMapper.writeValueAsString(value);
    } catch (Exception e) {
      return "null";
    }
  }
}
